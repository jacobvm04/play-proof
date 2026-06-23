// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PlayProof
 * @notice Onchain marketplace for verified human computer-use data — the
 *         recorded screen captures of real tasks that train computer-use AI
 *         agents. Gaming is one task category among many (form-filling,
 *         spreadsheet navigation, web research, etc.).
 *
 * Trust model — single trusted-reviewer verification:
 *   1. A dataset buyer (AI team) creates a bounty and escrows: rewardPerClip
 *      (paid to the contributor on approval) + reviewerReward (paid to the
 *      reviewer for their verdict).
 *   2. A contributor records a task, uploads it to 0G Storage, then calls
 *      submitClip() with the recording's 0G Storage root hash. The oracle may
 *      record a 0G Compute aiPreScore as an optional signal.
 *   3. A single trusted reviewer calls submitReview(id, approve). That one
 *      verdict SETTLES the submission immediately: approve → Approved (the
 *      contributor can claim), reject → Rejected (reward returns to budget).
 *      The reviewer is paid reviewerReward either way.
 *   4. On approval the contributor calls claimReward().
 *
 * Reviewer trust is enforced off-chain by the app (only trusted wallets are
 * shown the review queue); the contract records who reviewed for provenance.
 *
 * Provenance that matters lives on 0G Chain: contributor, the 0G Storage root
 * hash, the bounty, the optional AI pre-score, the reviewer + verdict, and the
 * payouts. Recordings live on 0G Storage; AI pre-scoring runs on 0G Compute.
 */
contract PlayProof {
    // ─────────────────────────────── Types ───────────────────────────────

    struct Bounty {
        uint256 id;
        address creator;        // dataset buyer (AI team)
        string title;
        string taskType;        // canonical category, e.g. "web_form", "game_fps"
        uint256 rewardPerClip;  // wei paid to contributor per approved submission
        uint256 reviewerReward; // wei paid to the reviewer who settles a submission
        uint256 remainingBudget;
        uint256 approvedCount;
        bool active;
    }

    struct Submission {
        uint256 id;
        uint256 bountyId;
        address contributor;
        string storageRootHash; // 0G Storage root hash of the recording
        uint256 aiPreScore;     // optional 0G Compute signal (0..100)
        address reviewer;        // who settled it (address(0) until reviewed)
        Status status;
        bool paid;
    }

    enum Status {
        Pending,   // awaiting a trusted review
        Approved,  // a trusted reviewer approved
        Rejected   // a trusted reviewer rejected
    }

    // ────────────────────────────── Storage ──────────────────────────────

    address public owner;   // deployer; can rotate the oracle
    address public oracle;  // posts optional AI pre-scores (runs 0G Compute)

    Bounty[] public bounties;
    Submission[] public submissions;

    mapping(uint256 => uint256[]) public submissionsByBounty;
    mapping(address => uint256[]) public submissionsByContributor;

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
        uint256 budget
    );
    event ClipSubmitted(
        uint256 indexed submissionId,
        uint256 indexed bountyId,
        address indexed contributor,
        string storageRootHash
    );
    event AiPreScored(uint256 indexed submissionId, uint256 aiPreScore);
    event SubmissionReviewed(
        uint256 indexed submissionId,
        address indexed reviewer,
        bool approve,
        Status status
    );
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
    error CannotReviewOwn();

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
    /// @dev Budget must cover at least one full payout: rewardPerClip + reviewerReward.
    function createBounty(
        string calldata title,
        string calldata taskType,
        uint256 rewardPerClip,
        uint256 reviewerReward
    ) external payable returns (uint256 bountyId) {
        if (rewardPerClip == 0) revert ZeroReward();
        uint256 perSubmission = rewardPerClip + reviewerReward;
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
                remainingBudget: msg.value,
                approvedCount: 0,
                active: true
            })
        );

        emit BountyCreated(bountyId, msg.sender, title, taskType, rewardPerClip, reviewerReward, msg.value);
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

    /// @notice Contributor submits a recording's 0G Storage root hash.
    /// @dev Reserves the full per-submission cost (contributor reward +
    ///      reviewer reward) so the review payout and the claim are solvent.
    function submitClip(uint256 bountyId, string calldata storageRootHash)
        external
        returns (uint256 submissionId)
    {
        Bounty storage b = bounties[bountyId];
        if (!b.active) revert BountyInactive();

        uint256 perSubmission = b.rewardPerClip + b.reviewerReward;
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
                reviewer: address(0),
                status: Status.Pending,
                paid: false
            })
        );

        submissionsByBounty[bountyId].push(submissionId);
        submissionsByContributor[msg.sender].push(submissionId);

        emit ClipSubmitted(submissionId, bountyId, msg.sender, storageRootHash);
    }

    /// @notice Oracle records an optional 0G Compute AI pre-score signal.
    function setAiPreScore(uint256 submissionId, uint256 aiPreScore) external onlyOracle {
        if (aiPreScore > 100) revert BadScore();
        Submission storage s = submissions[submissionId];
        if (s.status != Status.Pending) revert NotPending();
        s.aiPreScore = aiPreScore;
        emit AiPreScored(submissionId, aiPreScore);
    }

    /// @notice A single trusted reviewer settles a submission with one verdict.
    ///         approve → Approved (claimable); reject → Rejected (reward returned
    ///         to the bounty budget). The reviewer is paid reviewerReward either
    ///         way. Reviewer trust is gated by the app, not on-chain.
    function submitReview(uint256 submissionId, bool approve) external {
        Submission storage s = submissions[submissionId];
        if (s.status != Status.Pending) revert NotPending();
        if (s.contributor == msg.sender) revert CannotReviewOwn();

        Bounty storage b = bounties[s.bountyId];

        s.reviewer = msg.sender;
        reviewsByReviewer[msg.sender] += 1;

        if (approve) {
            s.status = Status.Approved;
            b.approvedCount += 1;
            approvedByContributor[s.contributor] += 1;
        } else {
            s.status = Status.Rejected;
            // Return the contributor's reserved reward to the bounty budget
            // (the reviewer reward is paid out below regardless).
            b.remainingBudget += b.rewardPerClip;
        }

        emit SubmissionReviewed(submissionId, msg.sender, approve, s.status);

        // Pay the reviewer reward (reserved at submitClip time).
        uint256 r = b.reviewerReward;
        if (r > 0) {
            earnedByReviewer[msg.sender] += r;
            (bool ok, ) = payable(msg.sender).call{value: r}("");
            if (!ok) revert TransferFailed();
        }
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
}
