// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PlayProof
 * @notice Onchain marketplace for verified human computer-use data — the
 *         recorded traces (screen + synced keyboard/mouse input) that train
 *         computer-use AI agents. Gaming is one task category among many
 *         (form-filling, spreadsheet navigation, web research, etc.).
 *
 * Trust model — AI pre-screen + decentralized human review consensus:
 *   1. A dataset buyer (AI team) calls createBounty() for a task type and
 *      escrows: rewardPerClip (paid to the contributor on approval) plus a
 *      per-review reward (paid to each reviewer). They set requiredReviews = N.
 *   2. A contributor records a trace bundle, uploads it to 0G Storage, then
 *      calls submitClip() with the bundle's 0G Storage root hash. 0G Compute
 *      assigns an AI pre-score (a signal, stored on-chain — NOT the final word).
 *   3. Up to N independent reviewers each call submitReview(id, approve) once.
 *      Reviewers are paid the per-review reward immediately for participating.
 *   4. Once N reviews are in, anyone calls finalize(id): the submission is
 *      APPROVED iff a strict majority (>50%) of reviews are positive, else
 *      REJECTED. The tally is computed trustlessly in the contract.
 *   5. On approval the contributor calls claimReward().
 *
 * Provenance that matters lives on 0G Chain: contributor, the 0G Storage root
 * hash, the task bounty, the AI pre-score, every reviewer's verdict, the
 * consensus outcome, and the payouts. Trace bytes live on 0G Storage; AI
 * pre-scoring runs on 0G Compute. This contract is settlement + provenance.
 */
contract PlayProof {
    // ─────────────────────────────── Types ───────────────────────────────

    struct Bounty {
        uint256 id;
        address creator;        // dataset buyer (AI team)
        string title;           // "Fill out a multi-step web form"
        string taskType;        // canonical category, e.g. "web_form", "spreadsheet", "game_fps"
        uint256 rewardPerClip;  // wei paid to contributor per approved submission
        uint256 reviewerReward; // wei paid to each reviewer who reviews a submission
        uint8 requiredReviews;  // N reviews needed before finalize() is allowed
        uint256 remainingBudget;
        uint256 approvedCount;
        bool active;
    }

    struct Submission {
        uint256 id;
        uint256 bountyId;
        address contributor;
        string storageRootHash; // 0G Storage root hash of the trace bundle
        uint256 aiPreScore;     // 0..100 from 0G Compute — a signal, not the verdict
        uint16 positiveReviews;
        uint16 totalReviews;
        Status status;
        bool paid;
    }

    enum Status {
        Pending,   // awaiting reviews
        Approved,  // >50% positive at finalize
        Rejected   // not a majority
    }

    // ────────────────────────────── Storage ──────────────────────────────

    address public owner;   // deployer; can rotate the oracle
    address public oracle;  // posts AI pre-scores (runs 0G Compute)

    Bounty[] public bounties;
    Submission[] public submissions;

    mapping(uint256 => uint256[]) public submissionsByBounty;
    mapping(address => uint256[]) public submissionsByContributor;
    // submissionId => reviewer => has reviewed (one vote per wallet)
    mapping(uint256 => mapping(address => bool)) public hasReviewed;
    // submissionId => list of reviewers (for provenance)
    mapping(uint256 => address[]) public reviewersOf;

    mapping(address => uint256) public earnedByContributor; // claimed rewards
    mapping(address => uint256) public approvedByContributor;
    mapping(address => uint256) public reviewsByReviewer;    // reviews cast
    mapping(address => uint256) public earnedByReviewer;     // review rewards

    // ─────────────────────────────── Events ──────────────────────────────

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        string title,
        string taskType,
        uint256 rewardPerClip,
        uint256 reviewerReward,
        uint8 requiredReviews,
        uint256 budget
    );
    event ClipSubmitted(
        uint256 indexed submissionId,
        uint256 indexed bountyId,
        address indexed contributor,
        string storageRootHash
    );
    event AiPreScored(uint256 indexed submissionId, uint256 aiPreScore);
    event ReviewSubmitted(
        uint256 indexed submissionId,
        address indexed reviewer,
        bool approve,
        uint16 positiveReviews,
        uint16 totalReviews
    );
    event SubmissionFinalized(uint256 indexed submissionId, Status status, uint16 positiveReviews, uint16 totalReviews);
    event RewardClaimed(uint256 indexed submissionId, address indexed contributor, uint256 amount);
    event OracleChanged(address indexed oracle);
    event BountyFunded(uint256 indexed bountyId, uint256 amount);

    // ─────────────────────────────── Errors ──────────────────────────────

    error NotOwner();
    error NotOracle();
    error BountyInactive();
    error InsufficientBudget();
    error NotPending();
    error NotApproved();
    error NotContributor();
    error AlreadyPaid();
    error ZeroReward();
    error TransferFailed();
    error BadScore();
    error BadReviewCount();
    error AlreadyReviewed();
    error CannotReviewOwn();
    error ReviewsNotComplete();
    error ReviewsFull();

    // ─────────────────────────────── Modifiers ───────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    constructor(address _oracle) {
        owner = msg.sender;
        oracle = _oracle == address(0) ? msg.sender : _oracle;
        emit OracleChanged(oracle);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleChanged(_oracle);
    }

    // ─────────────────────────────── Bounties ────────────────────────────

    /// @notice Create a task-data bounty and escrow its budget (msg.value).
    /// @dev Budget must cover at least one full payout: rewardPerClip plus
    ///      N reviewer rewards.
    function createBounty(
        string calldata title,
        string calldata taskType,
        uint256 rewardPerClip,
        uint256 reviewerReward,
        uint8 requiredReviews
    ) external payable returns (uint256 bountyId) {
        if (rewardPerClip == 0) revert ZeroReward();
        if (requiredReviews == 0 || requiredReviews > 50) revert BadReviewCount();
        uint256 perSubmission = rewardPerClip + uint256(reviewerReward) * requiredReviews;
        if (msg.value < perSubmission) revert InsufficientBudget();

        bountyId = bounties.length;
        bounties.push(
            Bounty({
                id: bountyId,
                creator: msg.sender,
                title: title,
                taskType: taskType,
                rewardPerClip: rewardPerClip,
                reviewerReward: reviewerReward,
                requiredReviews: requiredReviews,
                remainingBudget: msg.value,
                approvedCount: 0,
                active: true
            })
        );

        emit BountyCreated(
            bountyId, msg.sender, title, taskType, rewardPerClip, reviewerReward, requiredReviews, msg.value
        );
    }

    function fundBounty(uint256 bountyId) external payable {
        Bounty storage b = bounties[bountyId];
        if (!b.active) revert BountyInactive();
        b.remainingBudget += msg.value;
        emit BountyFunded(bountyId, msg.value);
    }

    function closeBounty(uint256 bountyId) external {
        Bounty storage b = bounties[bountyId];
        if (msg.sender != b.creator && msg.sender != owner) revert NotOwner();
        b.active = false;
        uint256 refund = b.remainingBudget;
        b.remainingBudget = 0;
        if (refund > 0) {
            (bool ok, ) = payable(b.creator).call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
    }

    // ───────────────────────────── Submissions ───────────────────────────

    /// @notice Contributor submits a trace bundle's 0G Storage root hash.
    /// @dev Reserves the full per-submission cost (contributor reward + all
    ///      reviewer rewards) so reviews and the final claim are always solvent.
    function submitClip(uint256 bountyId, string calldata storageRootHash)
        external
        returns (uint256 submissionId)
    {
        Bounty storage b = bounties[bountyId];
        if (!b.active) revert BountyInactive();

        uint256 perSubmission = b.rewardPerClip + uint256(b.reviewerReward) * b.requiredReviews;
        if (b.remainingBudget < perSubmission) revert InsufficientBudget();
        b.remainingBudget -= perSubmission;

        submissionId = submissions.length;
        submissions.push(
            Submission({
                id: submissionId,
                bountyId: bountyId,
                contributor: msg.sender,
                storageRootHash: storageRootHash,
                aiPreScore: 0,
                positiveReviews: 0,
                totalReviews: 0,
                status: Status.Pending,
                paid: false
            })
        );

        submissionsByBounty[bountyId].push(submissionId);
        submissionsByContributor[msg.sender].push(submissionId);

        emit ClipSubmitted(submissionId, bountyId, msg.sender, storageRootHash);
    }

    /// @notice Oracle records the 0G Compute AI pre-score (a review signal).
    function setAiPreScore(uint256 submissionId, uint256 aiPreScore) external onlyOracle {
        if (aiPreScore > 100) revert BadScore();
        Submission storage s = submissions[submissionId];
        if (s.status != Status.Pending) revert NotPending();
        s.aiPreScore = aiPreScore;
        emit AiPreScored(submissionId, aiPreScore);
    }

    // ─────────────────────────────── Reviews ─────────────────────────────

    /// @notice An independent reviewer casts a verdict (approve/reject) once.
    ///         Paid the bounty's per-review reward immediately for participating.
    function submitReview(uint256 submissionId, bool approve) external {
        Submission storage s = submissions[submissionId];
        if (s.status != Status.Pending) revert NotPending();
        if (s.contributor == msg.sender) revert CannotReviewOwn();
        if (hasReviewed[submissionId][msg.sender]) revert AlreadyReviewed();

        Bounty storage b = bounties[s.bountyId];
        if (s.totalReviews >= b.requiredReviews) revert ReviewsFull();

        hasReviewed[submissionId][msg.sender] = true;
        reviewersOf[submissionId].push(msg.sender);
        s.totalReviews += 1;
        if (approve) s.positiveReviews += 1;
        reviewsByReviewer[msg.sender] += 1;

        // Pay the reviewer reward (reserved at submitClip time).
        uint256 r = b.reviewerReward;
        if (r > 0) {
            earnedByReviewer[msg.sender] += r;
            (bool ok, ) = payable(msg.sender).call{value: r}("");
            if (!ok) revert TransferFailed();
        }

        emit ReviewSubmitted(submissionId, msg.sender, approve, s.positiveReviews, s.totalReviews);
    }

    /// @notice Finalize a submission once N reviews are in. Anyone may call.
    ///         APPROVED iff a strict majority (>50%) of reviews are positive.
    function finalize(uint256 submissionId) external {
        Submission storage s = submissions[submissionId];
        if (s.status != Status.Pending) revert NotPending();

        Bounty storage b = bounties[s.bountyId];
        if (s.totalReviews < b.requiredReviews) revert ReviewsNotComplete();

        // Strict majority: positive * 2 > total.
        bool approved = uint256(s.positiveReviews) * 2 > uint256(s.totalReviews);
        if (approved) {
            s.status = Status.Approved;
            b.approvedCount += 1;
            approvedByContributor[s.contributor] += 1;
        } else {
            s.status = Status.Rejected;
            // Return the contributor's reserved reward to the bounty budget
            // (reviewer rewards were already paid out as reviews came in).
            b.remainingBudget += b.rewardPerClip;
        }

        emit SubmissionFinalized(submissionId, s.status, s.positiveReviews, s.totalReviews);
    }

    /// @notice Contributor claims the reward for an approved submission.
    function claimReward(uint256 submissionId) external {
        Submission storage s = submissions[submissionId];
        if (s.contributor != msg.sender) revert NotContributor();
        if (s.status != Status.Approved) revert NotApproved();
        if (s.paid) revert AlreadyPaid();

        Bounty storage b = bounties[s.bountyId];
        uint256 amount = b.rewardPerClip;

        s.paid = true;
        earnedByContributor[msg.sender] += amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(submissionId, msg.sender, amount);
    }

    // ─────────────────────────────── Views ───────────────────────────────

    function bountyCount() external view returns (uint256) {
        return bounties.length;
    }
    function submissionCount() external view returns (uint256) {
        return submissions.length;
    }
    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }
    function getSubmission(uint256 submissionId) external view returns (Submission memory) {
        return submissions[submissionId];
    }
    function getSubmissionsByBounty(uint256 bountyId) external view returns (uint256[] memory) {
        return submissionsByBounty[bountyId];
    }
    function getSubmissionsByContributor(address who) external view returns (uint256[] memory) {
        return submissionsByContributor[who];
    }
    function getReviewers(uint256 submissionId) external view returns (address[] memory) {
        return reviewersOf[submissionId];
    }
}
