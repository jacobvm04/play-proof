// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PlayProof
 * @notice Onchain gameplay-data marketplace for AI training.
 *
 * Lifecycle:
 *   1. A dataset buyer (AI team) calls createBounty() and escrows reward budget.
 *   2. A player records gameplay, uploads the clip to 0G Storage, then calls
 *      submitClip() with the 0G Storage root hash as tamper-resistant provenance.
 *   3. The PlayProof oracle (which runs the 0G Compute AI quality/labeling check)
 *      calls approveSubmission() with the Proof-of-Play score, or rejectSubmission().
 *   4. The player calls claimReward() to receive the escrowed reward for an
 *      approved submission.
 *
 * Everything that matters for provenance lives on 0G Chain: contributor wallet,
 * the 0G Storage root hash, the bounty it answered, the AI quality score, and
 * the payout. The clip bytes themselves live on 0G Storage; AI scoring runs on
 * 0G Compute. This contract is the settlement + provenance layer.
 */
contract PlayProof {
    // ─────────────────────────────── Types ───────────────────────────────

    struct Bounty {
        uint256 id;
        address creator;       // dataset buyer (AI team)
        string title;          // "Collect parkour failure recovery clips"
        string requiredLabel;  // canonical label the clip must demonstrate, e.g. "parkour"
        uint256 rewardPerClip; // wei of 0G paid per approved clip
        uint256 remainingBudget; // escrowed funds still available
        uint256 approvedCount; // approved submissions so far
        bool active;
    }

    struct Submission {
        uint256 id;
        uint256 bountyId;
        address player;
        string storageRootHash; // 0G Storage root hash — canonical provenance
        uint256 qualityScore;   // Proof-of-Play score, 0..100 (set on approval)
        Status status;
        bool paid;
    }

    enum Status {
        Pending,
        Approved,
        Rejected
    }

    // ────────────────────────────── Storage ──────────────────────────────

    address public owner;        // deployer; can rotate the oracle
    address public oracle;       // approves/rejects (runs 0G Compute AI checks)

    Bounty[] public bounties;
    Submission[] public submissions;

    // bountyId => list of submission ids
    mapping(uint256 => uint256[]) public submissionsByBounty;
    // player => list of submission ids
    mapping(address => uint256[]) public submissionsByPlayer;
    // player => lifetime 0G earned (claimed)
    mapping(address => uint256) public earnedByPlayer;
    // player => approved clip count (for the leaderboard)
    mapping(address => uint256) public approvedByPlayer;

    // ─────────────────────────────── Events ──────────────────────────────

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed creator,
        string title,
        string requiredLabel,
        uint256 rewardPerClip,
        uint256 budget
    );
    event ClipSubmitted(
        uint256 indexed submissionId,
        uint256 indexed bountyId,
        address indexed player,
        string storageRootHash
    );
    event SubmissionApproved(uint256 indexed submissionId, uint256 qualityScore);
    event SubmissionRejected(uint256 indexed submissionId);
    event RewardClaimed(uint256 indexed submissionId, address indexed player, uint256 amount);
    event OracleChanged(address indexed oracle);
    event BountyFunded(uint256 indexed bountyId, uint256 amount);

    // ─────────────────────────────── Errors ──────────────────────────────

    error NotOwner();
    error NotOracle();
    error BountyInactive();
    error InsufficientBudget();
    error NotPending();
    error NotApproved();
    error NotSubmissionOwner();
    error AlreadyPaid();
    error ZeroReward();
    error TransferFailed();
    error BadScore();

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

    // ─────────────────────────────── Admin ───────────────────────────────

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleChanged(_oracle);
    }

    // ─────────────────────────────── Bounties ────────────────────────────

    /// @notice Create a dataset bounty and escrow its reward budget (msg.value).
    function createBounty(
        string calldata title,
        string calldata requiredLabel,
        uint256 rewardPerClip
    ) external payable returns (uint256 bountyId) {
        if (rewardPerClip == 0) revert ZeroReward();
        if (msg.value < rewardPerClip) revert InsufficientBudget();

        bountyId = bounties.length;
        bounties.push(
            Bounty({
                id: bountyId,
                creator: msg.sender,
                title: title,
                requiredLabel: requiredLabel,
                rewardPerClip: rewardPerClip,
                remainingBudget: msg.value,
                approvedCount: 0,
                active: true
            })
        );

        emit BountyCreated(bountyId, msg.sender, title, requiredLabel, rewardPerClip, msg.value);
    }

    /// @notice Add more budget to an existing bounty.
    function fundBounty(uint256 bountyId) external payable {
        Bounty storage b = bounties[bountyId];
        if (!b.active) revert BountyInactive();
        b.remainingBudget += msg.value;
        emit BountyFunded(bountyId, msg.value);
    }

    /// @notice Creator closes a bounty and reclaims any unspent budget.
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

    /// @notice Player submits a clip's 0G Storage root hash against a bounty.
    function submitClip(uint256 bountyId, string calldata storageRootHash)
        external
        returns (uint256 submissionId)
    {
        Bounty storage b = bounties[bountyId];
        if (!b.active) revert BountyInactive();

        submissionId = submissions.length;
        submissions.push(
            Submission({
                id: submissionId,
                bountyId: bountyId,
                player: msg.sender,
                storageRootHash: storageRootHash,
                qualityScore: 0,
                status: Status.Pending,
                paid: false
            })
        );

        submissionsByBounty[bountyId].push(submissionId);
        submissionsByPlayer[msg.sender].push(submissionId);

        emit ClipSubmitted(submissionId, bountyId, msg.sender, storageRootHash);
    }

    /// @notice Oracle approves a submission with its Proof-of-Play score (0..100).
    /// @dev Reserves reward budget at approval time so claims can't overdraw.
    function approveSubmission(uint256 submissionId, uint256 qualityScore)
        external
        onlyOracle
    {
        if (qualityScore > 100) revert BadScore();
        Submission storage s = submissions[submissionId];
        if (s.status != Status.Pending) revert NotPending();

        Bounty storage b = bounties[s.bountyId];
        if (b.remainingBudget < b.rewardPerClip) revert InsufficientBudget();

        // Reserve the reward now so a later claim is always solvent.
        b.remainingBudget -= b.rewardPerClip;
        b.approvedCount += 1;

        s.status = Status.Approved;
        s.qualityScore = qualityScore;
        approvedByPlayer[s.player] += 1;

        emit SubmissionApproved(submissionId, qualityScore);
    }

    /// @notice Oracle rejects a submission (low quality / off-label / duplicate).
    function rejectSubmission(uint256 submissionId) external onlyOracle {
        Submission storage s = submissions[submissionId];
        if (s.status != Status.Pending) revert NotPending();
        s.status = Status.Rejected;
        emit SubmissionRejected(submissionId);
    }

    /// @notice Player claims the reward for an approved submission.
    function claimReward(uint256 submissionId) external {
        Submission storage s = submissions[submissionId];
        if (s.player != msg.sender) revert NotSubmissionOwner();
        if (s.status != Status.Approved) revert NotApproved();
        if (s.paid) revert AlreadyPaid();

        Bounty storage b = bounties[s.bountyId];
        uint256 amount = b.rewardPerClip;

        s.paid = true;
        earnedByPlayer[msg.sender] += amount;

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

    function getSubmissionsByPlayer(address player) external view returns (uint256[] memory) {
        return submissionsByPlayer[player];
    }
}
