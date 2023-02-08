// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";

import "./IProjectRegistry.sol";

interface IStreamRegistry {
    enum PermissionType { Edit, Delete, Publish, Subscribe, Grant }
    function hasPermission(string calldata streamId, address user, PermissionType permissionType) external view returns (bool userHasPermission);
    function grantPermission(string calldata streamId, address user, PermissionType permissionType) external;
}

contract ProjectRegistry is Initializable, UUPSUpgradeable, ERC2771ContextUpgradeable, AccessControlUpgradeable, IProjectRegistry {

    bytes32 public constant TRUSTED_ROLE = keccak256("TRUSTED_ROLE");
    bytes32 public constant TRUSTED_FORWARDER_ROLE = keccak256("TRUSTED_FORWARDER_ROLE");

    IStreamRegistry public streamRegistry;
    mapping (bytes32 => Project) public projects;

    modifier hasDeletePermission(bytes32 projectId) {
        require(hasPermissionType(projectId, _msgSender(), PermissionType.Delete), "error_noDeletePermission");
        _;
    }
    modifier hasEditPermission(bytes32 projectId) {
        require(hasPermissionType(projectId, _msgSender(), PermissionType.Edit), "error_noEditPermission");
        _;
    }
    modifier hasGrantPermission(bytes32 projectId) {
        require(hasPermissionType(projectId, _msgSender(), PermissionType.Grant), "error_noGrantPermission");
        _;
    }
    modifier hasGrantPermissionOrIsTrusted(bytes32 projectId) {
        require(hasPermissionType(projectId, _msgSender(), PermissionType.Grant) || hasRole(TRUSTED_ROLE, _msgSender()), "error_noGrantPermissionOrNotTrusted");
        _;
    }
    modifier projectExists(bytes32 projectId) {
        require(exists(projectId), "error_projectDoesNotExist");
        _;
    }
    modifier isTrusted() {
        require(hasRole(TRUSTED_ROLE, _msgSender()), "error_mustBeTrustedRole");
        _;
    }

    // Zero Address is passed to ERC2771ContextUpgradeable contract since trusted forwarder is handled through TRUSTED_FORWARDER_ROLE and isTrustedForwarder
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0x0)) {}

    // Constructor can't be used with upgradeable contracts, so use initialize instead
    //    this will not be called upon each upgrade, only once during first deployment
    function initialize(address _streamRegistry) public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        streamRegistry = IStreamRegistry(_streamRegistry);
    }

    function _authorizeUpgrade(address) internal override isTrusted() {}


    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return super._msgData();
    }

    /////////////// Project Management /////////////////

    /**
    * Returns if a project can be bought (e.g. through the Marketplace)
    * A project can be bought if it's public purchable OR if the buyer has Buy permission
    * @dev A project is public purchable if the address(0) has Buy permission
    */
    function canBuyProject(bytes32 projectId, address buyer) public view returns(bool isPurchable) {
        return hasPermissionType(projectId, address(0), PermissionType.Buy) || hasPermissionType(projectId, buyer, PermissionType.Buy);
    }

    function exists(bytes32 projectId) public view returns (bool) {
        return projects[projectId].version != 0;
    }

    /**
     * Computes the key from project version and user address. Is incremented when project is (re-)created
     */
    function getAddressKey(bytes32 projectId, address user) public view returns (bytes32) {
        return keccak256(abi.encode(projects[projectId].version, user));
    }

    /**
     * Returns Project struct items except for permissions which are linked to a user/projectVersion hash.
     */
    function getProject(
        bytes32 id,
        uint32[] memory domainIds
    )
        external
        view
        returns (
            PaymentDetailsByChain[] memory paymentDetails,
            uint256 minimumSubscriptionSeconds,
            string memory metadata,
            uint32 version,
            string[] memory streams
        )
    {
        Project storage p = projects[id];

        paymentDetails = new PaymentDetailsByChain[](domainIds.length);
        for (uint256 i = 0; i < domainIds.length; i++) {
            paymentDetails[i] = p.paymentDetails[domainIds[i]];
        }

        return (
            paymentDetails,
            p.minimumSubscriptionSeconds,
            p.metadata,
            p.version,
            p.streams
        );
    }

    /**
     * Returns the payment details for a project on a specific chain
     */
    function getPaymentDetailsByChain(
        bytes32 projectId,
        uint32 domainId
    ) external view returns (
        address beneficiary,
        address pricingTokenAddress,
        uint256 pricePerSecond)
    {
        Project storage p = projects[projectId];
        PaymentDetailsByChain storage paymentDetailsByChain = p.paymentDetails[domainId];
        return (paymentDetailsByChain.beneficiary, paymentDetailsByChain.pricingTokenAddress, paymentDetailsByChain.pricePerSecond);
    }

    /**
     * Add payment details for a project for a specific chain
     */
    function updatePaymentDetailsByChain(
        bytes32 projectId,
        uint32 domainId,
        address beneficiary,
        address pricingToken,
        uint256 pricePerSecond
    ) external projectExists(projectId) hasEditPermission(projectId) {
        PaymentDetailsByChain memory paymentDetailsByChain = PaymentDetailsByChain({
            beneficiary: beneficiary,
            pricingTokenAddress: pricingToken,
            pricePerSecond: pricePerSecond
        });
        Project storage p = projects[projectId];
        p.paymentDetails[domainId] = paymentDetailsByChain;
        emit PaymentDetailsByChainUpdated(projectId, domainId, beneficiary, pricingToken, pricePerSecond);
    }

    /**
    * Creates a new project in the registry. All permissions are enabled for msg.sender
    * @param paymentDetailsByChain contains the beneficiary & pricingToken & pricePerSecond for supported chains
    * @dev version is incrementally generated
    * @dev permissions are enabled for msg.sender (and the zero address if project is public purchable)
    */
    function createProject(
        bytes32 projectId,
        uint32[] calldata domainIds,
        PaymentDetailsByChain[] calldata paymentDetailsByChain,
        string[] calldata streams,
        uint minimumSubscriptionSeconds,
        bool isPublicPurchable,
        string calldata metadataJsonString
    ) public {
        _createProject(projectId, domainIds, paymentDetailsByChain, streams, minimumSubscriptionSeconds, metadataJsonString);
        _setPermissionBooleans(projectId, _msgSender(), true, true, true, true);
        if (isPublicPurchable) {
            _setPermissionBooleans(projectId, address(0), true, true, true, true);
        }
    }

    function deleteProject(bytes32 projectId) public hasDeletePermission(projectId) {
        delete projects[projectId];
        emit ProjectDeleted(projectId);
    }

    /**
    * Updates project fields except for: version, permissions mapping
    * @dev version is auto-incremented and is not editable
    * @dev streams[] has dedicated methods under streams management as well
    * @dev permissions have dedicated methods under permissions management (supports other then msg.sender subscribers as well)
    */
    function updateProject(
        bytes32 projectId,
        uint32[] calldata domainIds,
        PaymentDetailsByChain[] calldata paymentDetailsByChain,
        string[] calldata streams,
        uint minimumSubscriptionSeconds,
        string calldata metadataJsonString
    ) public projectExists(projectId) hasEditPermission(projectId) {
        Project storage p = projects[projectId];
        p.minimumSubscriptionSeconds = minimumSubscriptionSeconds;
        p.metadata = metadataJsonString;
        setStreams(p.id, streams);
        emit ProjectUpdated(projectId, domainIds, paymentDetailsByChain, streams, minimumSubscriptionSeconds, metadataJsonString);

        for(uint256 i = 0; i < domainIds.length; i++) {
            p.paymentDetails[domainIds[i]] = paymentDetailsByChain[i];
            emit PaymentDetailsByChainUpdated(
                projectId,
                domainIds[i],
                paymentDetailsByChain[i].beneficiary,
                paymentDetailsByChain[i].pricingTokenAddress,
                paymentDetailsByChain[i].pricePerSecond
            );
        }
    }

    function _createProject(
        bytes32 id,
        uint32[] calldata domainIds,
        PaymentDetailsByChain[] calldata paymentDetailsByChain,
        string[] calldata streams,
        uint256 minimumSubscriptionSeconds,
        string calldata metadataJsonString
    ) internal {
        require(id != 0x0, "error_nullProjectId");
        require(!exists(id), "error_alreadyExists");
        require(domainIds.length == paymentDetailsByChain.length, "error_invalidPaymentDetailsByChain");

        Project storage p = projects[id];
        p.id = id;
        for(uint256 i = 0; i < streams.length; i++) {
            _addStream(id, streams[i]);
        }
        p.minimumSubscriptionSeconds = minimumSubscriptionSeconds;
        p.metadata = metadataJsonString;
        p.version = projects[id].version + 1;
        emit ProjectCreated(id, domainIds, paymentDetailsByChain, streams, minimumSubscriptionSeconds, metadataJsonString);

        for(uint256 i = 0; i < domainIds.length; i++) {
            PaymentDetailsByChain memory payment = paymentDetailsByChain[i];
            p.paymentDetails[domainIds[i]] = payment;
            emit PaymentDetailsByChainUpdated(id, domainIds[i], payment.beneficiary, payment.pricingTokenAddress, payment.pricePerSecond);
        }
    }

    ///////////////// Subscription management ///////////////

    function getSubscription(bytes32 projectId, address subscriber) public view returns (bool isValid, uint endTimestamp) {
        (, TimeBasedSubscription storage sub) = _getSubscription(projectId, subscriber);
        return (_isValid(sub), sub.endTimestamp);
    }

    function getOwnSubscription(bytes32 projectId) public view returns (bool isValid, uint endTimestamp) {
        return getSubscription(projectId, _msgSender());
    }

    function _isValid(TimeBasedSubscription storage s) internal view returns (bool) {
        return s.endTimestamp >= block.timestamp; // solhint-disable-line not-rely-on-time
    }

    /**
     * Extend subscription on the project and enable Subscribe permission on all streams added to the project.
     * Must have either Grant permission on the project or be a trusted role
     * e.g. Marketplace will need to be a trusted role when granting subscriptions to buyers
     */
    function grantSubscription(bytes32 projectId, uint subscriptionSeconds, address subscriber) public hasGrantPermissionOrIsTrusted(projectId) {
        _addOrExtendSubscription(projectId, subscriptionSeconds, subscriber);
        _grantSubscribeForAllStreams(projectId, subscriber);
    }

    /**
     * Checks if the subscriber currently has a valid subscription for the given project
     */
    function hasValidSubscription(bytes32 projectId, address subscriber) public view returns (bool isValid) {
        (isValid,) = getSubscription(projectId, subscriber);
    }

    /**
     * Gets subscriptions info from the subscriptions stored in this contract
     */
    function _getSubscription(bytes32 projectId, address subscriber) internal view returns (Project storage p, TimeBasedSubscription storage s) {
        p = projects[projectId];
        require(p.id != 0x0, "error_notFound");
        s = p.subscriptions[subscriber];
    }

    /**
     * Extends subscription endTimestamp by addSeconds amounts
     */
    function _addOrExtendSubscription(bytes32 projectId, uint addSeconds, address subscriber) internal {
        (Project storage p, TimeBasedSubscription storage oldSub) = _getSubscription(projectId, subscriber);

        uint endTimestamp;
        if (oldSub.endTimestamp > block.timestamp) { // solhint-disable-line not-rely-on-time
            require(addSeconds > 0, "error_topUpTooSmall");
            endTimestamp = oldSub.endTimestamp + addSeconds;
            oldSub.endTimestamp = endTimestamp;
            emit SubscriptionExtended(p.id, subscriber, endTimestamp);
        } else {
            require(addSeconds >= p.minimumSubscriptionSeconds, "error_newSubscriptionTooSmall");
            endTimestamp = block.timestamp + addSeconds; // solhint-disable-line not-rely-on-time
            TimeBasedSubscription memory newSub = TimeBasedSubscription(endTimestamp);
            p.subscriptions[subscriber] = newSub;
            emit NewSubscription(p.id, subscriber, endTimestamp);
        }

        emit Subscribed(p.id, subscriber, endTimestamp);
    }

    /////////////// Streams Management /////////////////

    function addStream(bytes32 projectId, string calldata streamId) public projectExists(projectId) hasEditPermission(projectId) {
        require(!isStreamAdded(projectId, streamId), "error_streamAlreadyAdded");
        _addStream(projectId, streamId);
    }

    /**
     * Add multiple streams to the project; silently skips already added streams
     */
    function addStreams(bytes32 projectId, string[] calldata streamIds) public projectExists(projectId) hasEditPermission(projectId) {
        for(uint256 i = 0; i < streamIds.length; i++) {
            string calldata s = streamIds[i];
            if (!isStreamAdded(projectId, s)) {
                _addStream(projectId, s);
            }
        }
    }

    function _addStream(bytes32 projectId, string calldata streamId) private {
        require(streamRegistry.hasPermission(streamId, _msgSender(), IStreamRegistry.PermissionType.Grant), "error_noGrantPermissionForStream");
        _grantSubscribeForStream(streamId, address(this));
        projects[projectId].streams.push(streamId);
        projects[projectId].streamIndex[streamId] = projects[projectId].streams.length; // real array index + 1
        emit StreamAdded(projectId, streamId);
    }

    /**
     * Removes the stream from the project
     * @dev streams order is not important
     * @dev to leave no gaps, replaces the deleted streamId with the last element, then pops the last element
     */
    function removeStream(bytes32 projectId, string memory streamId) public projectExists(projectId) hasEditPermission(projectId) {
        string[] storage streams = projects[projectId].streams;
        mapping(string => uint) storage streamIndex = projects[projectId].streamIndex;
        uint i = streamIndex[streamId];
        require(i > 0, "error_streamNotFound");
        // don't replace if there's only one stream...
        if (streams.length > 1) {
            string memory lastStream = streams[streams.length - 1];
            streams[i - 1] = lastStream;
            streamIndex[lastStream] = i; // real index + 1
        }
        streams.pop();
        delete streamIndex[streamId];
        emit StreamRemoved(projectId, streamId);
    }

    function setStreams(bytes32 projectId, string[] calldata newStreams) public projectExists(projectId) hasEditPermission(projectId) {
        Project storage p = projects[projectId];
        string[] storage oldStreams = p.streams;
        uint oldStreamCount = oldStreams.length;
        mapping(string => uint) storage streamIndex = p.streamIndex;

        // mark old streams for keeping if they're also found in new streams
        for (uint i = 0; i < newStreams.length; i++) {
            string calldata s = newStreams[i];
            if (streamIndex[s] > 0) {
                streamIndex[s] = 1 ether; // hack: mark using spare bits in index (no real index can be 1e18)
            }
        }

        // compact the old streams: only keep the marked streams, remove the rest
        uint target = 0;
        for (uint source = 0; source < oldStreamCount; source++) {
            string storage s = oldStreams[source];
            if (streamIndex[s] == 1 ether) {
                if (source > target) { // don't move if it's already in the right place
                    oldStreams[target] = s;
                }
                target++;
                streamIndex[s] = target; // real index + 1
            } else {
                delete streamIndex[s];
                emit StreamRemoved(projectId, s);
            }
        }

        // pop the remaining trash (marked streams were already copied below j)
        for (; target < oldStreamCount; target++) {
            oldStreams.pop();
        }

        // add new streams on top if they weren't in the old streams
        addStreams(projectId, newStreams);
    }

    function isStreamAdded(bytes32 projectId, string calldata streamId) public view returns (bool) {
        return projects[projectId].streamIndex[streamId] > 0;
    }

    /**
     * Enable Grant permission for stream stored inside the StreamRegistry contract.
     * ProjectRegistry must have Grant permission on the stream in order to grant permissions to other users.
     * @param streamId for which the permission is granted. Streams permissions are handled by the StreamRegistry contract.
     * @param subscriber to which the permission is granted.
     */
    function _grantSubscribeForStream(string memory streamId, address subscriber) internal {
        streamRegistry.grantPermission(streamId, subscriber, IStreamRegistry.PermissionType.Subscribe);
    }

    /**
     * Enables Grant permission for all streams added to project.
     * @dev must have Grant permission on all streams
     */
    function _grantSubscribeForAllStreams(bytes32 projectId, address subscriber) internal {
        string[] memory streams = projects[projectId].streams;
        for(uint i = 0; i < streams.length; i++) {
            _grantSubscribeForStream(streams[i], subscriber);
        }
    }

    /////////////// Permissions Management /////////////////

    function hasPermissionType(bytes32 projectId, address user, PermissionType permissionType) public view returns (bool userHasPermissionType) {
        if (permissionType == PermissionType.Buy) {
            return projects[projectId].permissions[getAddressKey(projectId, user)].canBuy;
        }
        else if (permissionType == PermissionType.Delete) {
            return projects[projectId].permissions[getAddressKey(projectId, user)].canDelete;
        }
        else if (permissionType == PermissionType.Edit) {
            return projects[projectId].permissions[getAddressKey(projectId, user)].canEdit;
        }
        else if (permissionType == PermissionType.Grant) {
            return projects[projectId].permissions[getAddressKey(projectId, user)].canGrant;
        } else {
            revert("error_invalidPermissionType");
        }
    }

    function enablePermissionType(bytes32 projectId, address user, PermissionType permissionType) public hasGrantPermission(projectId) {
        _setPermission(projectId, user, permissionType, true);
    }

    function transferPermissionType(bytes32 projectId, address recipient, PermissionType permissionType) public {
        require(hasPermissionType(projectId, _msgSender(), permissionType), "error_noPermissionToTransfer");
        _setPermission(projectId, _msgSender(), permissionType, false);
        _setPermission(projectId, recipient, permissionType, true);
    }

    function revokePermissionType(bytes32 projectId, address user, PermissionType permissionType) public hasGrantPermission(projectId) {
        _setPermission(projectId, user, permissionType, false);
    }

    function getPermission(bytes32 projectId, address user) public view projectExists(projectId) returns (Permission memory permission) {
        return projects[projectId].permissions[getAddressKey(projectId, user)];
    }

    function setPermissionBooleans(bytes32 projectId, address user, bool canBuy, bool deletePerm, bool canEdit, bool canGrant) public hasGrantPermission(projectId) {
            _setPermissionBooleans(projectId, user, canBuy, deletePerm, canEdit, canGrant);
    }

    function revokeAllPermissionsForUser(bytes32 projectId, address user) public hasGrantPermission(projectId){
        delete projects[projectId].permissions[getAddressKey(projectId, user)];
        emit PermissionUpdated(projectId, user, false, false, false, false);
    }

    /**
     * Adds permissions for multiple users
     * users[] and permissions[] must have the same length
     */
    function setPermissionsForMultipleUsers(bytes32 projectId, address[] calldata users, Permission[] calldata permissions) public hasGrantPermission(projectId) {
        require(users.length == permissions.length, "error_invalidUserPermissionArrayLengths");
        uint arrayLength = users.length;
        for (uint i=0; i<arrayLength; i++) {
            Permission memory permission = permissions[i];
            _setPermissionBooleans(projectId, users[i], permission.canBuy, permission.canDelete, permission.canEdit, permission.canGrant);
        }
    }

    /**
     * Adds permissions for multiple projects
     * users[], permissions[] and projects[] must have the same length
     */
    function setPermissionsForMultipleProjects(bytes32[] calldata projectIds, address[][] calldata users, Permission[][] calldata permissions) public {
        require(users.length == permissions.length && permissions.length == projectIds.length, "error_invalidProjectUserPermissionArrayLengths");
        uint arrayLength = projectIds.length;
        for (uint i=0; i<arrayLength; i++) {
            setPermissionsForMultipleUsers(projectIds[i], users[i], permissions[i]);
        }
    }

    /**
     * Transfer all permissions from caller to the recipient address.
     * The recipient will have the caller's permissions without overwriting recipient's permissions, if any
     * The caller will have all permissions set to false
     */
    function transferAllPermissionsToUser(bytes32 projectId, address recipient) public {
        Permission memory permSender = getPermission(projectId, _msgSender());

        require(permSender.canBuy || permSender.canDelete || permSender.canEdit || permSender.canGrant,
            "error_noPermissionToTransfer");
        Permission memory permRecipient = getPermission(projectId, recipient);
        _setPermissionBooleans(projectId, recipient,
            permSender.canBuy || permRecipient.canBuy,
            permSender.canDelete || permRecipient.canDelete,
            permSender.canEdit || permRecipient.canEdit,
            permSender.canGrant || permRecipient.canGrant);
        _setPermissionBooleans(projectId, _msgSender(), false, false, false, false);
    }

    /////////////// Trusted Role /////////////////

    function getTrustedRole() public pure returns (bytes32) {
        return TRUSTED_ROLE;
    }

    /**
     * Allow the trusted role to create projects for others.
     * This enables the trusted roles to (manually) migrate projects from old (mainnet) contracts to the new one(s).
     */
    /**
    * Creates a new project in the registry. Permissions are enabled for the given user.
    * @param paymentDetailsByChain contains the beneficiary & pricingToken & pricePerSecond for supported chains
    * @param user The address that will have the permissions
    */
    function trustedCreateProject(
        bytes32 id,
        uint32[] calldata domainIds,
        PaymentDetailsByChain[] calldata paymentDetailsByChain,
        string[] calldata streams,
        uint minimumSubscriptionSeconds,
        address user,
        bool isPublicPurchable,
        string calldata metadataJsonString
    ) public isTrusted(){
        _createProject(id, domainIds, paymentDetailsByChain, streams, minimumSubscriptionSeconds, metadataJsonString);
        _setPermissionBooleans(id, user, true, true, true, true);
        if (isPublicPurchable) {
            _setPermissionBooleans(id, address(0), true, true, true, true);
        }
    }

    function trustedSetPermissions(
        bytes32 projectId,
        address user,
        bool canBuy,
        bool deletePerm,
        bool canEdit,
        bool canGrant
    ) public isTrusted() {
        _setPermissionBooleans(projectId, user, canBuy, deletePerm, canEdit, canGrant);
    }

    function trustedSetPermissionsForMultipleProjects(bytes32[] calldata projectIds, address[] calldata users, Permission[] calldata permissions) public isTrusted() {
        require(users.length == permissions.length, "error_invalidInputArrayLengths");
        uint arrayLength = projectIds.length;
        for (uint i = 0; i < arrayLength; i++) {
            bytes32 projectId = projectIds[i];
            Permission memory permission = permissions[i];
            _setPermissionBooleans(projectId, users[i], permission.canBuy, permission.canDelete, permission.canEdit, permission.canGrant);
        }
    }

    function _setPermission(bytes32 projectId, address user, PermissionType permissionType, bool grant) private {
        if (permissionType == PermissionType.Buy) {
           projects[projectId].permissions[getAddressKey(projectId, user)].canBuy = grant;
        }
        else if (permissionType == PermissionType.Delete) {
            projects[projectId].permissions[getAddressKey(projectId, user)].canDelete = grant;
        }
        else if (permissionType == PermissionType.Edit) {
           projects[projectId].permissions[getAddressKey(projectId, user)].canEdit = grant;
        }
        else if (permissionType == PermissionType.Grant) {
            projects[projectId].permissions[getAddressKey(projectId, user)].canGrant = grant;
        } else {
            revert("error_invalidPermissionType");
        }
        Permission memory perm = getPermission(projectId, user);
        emit PermissionUpdated(projectId, user, perm.canBuy, perm.canDelete, perm.canEdit, perm.canGrant);
    }

    function _setPermissionBooleans(bytes32 projectId, address user, bool canBuy, bool deletePerm, bool canEdit, bool canGrant) private {
        Permission memory perm = Permission({
            canBuy: canBuy,
            canDelete: deletePerm,
            canEdit: canEdit,
            canGrant: canGrant
        });
        projects[projectId].permissions[getAddressKey(projectId, user)] = perm;
        emit PermissionUpdated(projectId, user, canBuy, deletePerm, canEdit, canGrant);
    }

    /////////////// Trusted Forwarder /////////////////

    /*
     * Override openzeppelin's ERC2771ContextUpgradeable function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return hasRole(TRUSTED_FORWARDER_ROLE, forwarder);
    }
}
