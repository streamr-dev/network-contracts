// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IProjectRegistry {
    struct PaymentDetails {
        address beneficiary; // account where revenue is directed to
        address pricingTokenAddress; // the token in which the project is paid to project beneficiary
        uint256 pricePerSecond;
    }

    struct Project {
        bytes32 id;
        uint minimumSubscriptionSeconds;
        mapping(uint32 => PaymentDetails) chainIdToPaymentDetails;
        mapping(address => TimeBasedSubscription) subscriptions;
        string metadata;
        uint32 version; // incremented when project is (re-)created, so that users from old projects don't re-appear in the new project (if they have permissions)
        string[] streams;
        mapping(bytes32 => Permission) permissions; // keccak256(projectIdToVersion, userAddress) -> Permission
    }

    struct TimeBasedSubscription {
        uint endTimestamp;
    }

    enum PermissionType {
        Buy,
        Delete,
        Edit,
        Grant
    }

    struct Permission {
        bool canBuy;
        bool canDelete;
        bool canEdit;
        bool canGrant;
    }

    // project events
    event ProjectCreated(bytes32 indexed id, uint32[] domainIds, uint256 minimumSubscriptionSeconds, string metadata);
    event ProjectUpdated(bytes32 indexed id, uint32[] domainIds, uint256 minimumSubscriptionSeconds, string metadata);
    event ProjectDeleted(bytes32 indexed id);

    // subscription events
    event Subscribed(bytes32 indexed projectId, address indexed subscriber, uint endTimestamp);
    event NewSubscription(bytes32 indexed projectId, address indexed subscriber, uint endTimestamp);
    event SubscriptionExtended(bytes32 indexed projectId, address indexed subscriber, uint endTimestamp);

    // stream events
    event StreamAdded(bytes32 projectId, string streamId);
    event StreamRemoved(bytes32 projectId, string streamId);
    
    // permission events
    event PermissionUpdated(bytes32 projectId, address user, bool canBuy, bool canDelete, bool canEdit, bool canGrant);

    // project management functions

    // view functions
    function canBuyProject(bytes32 projectId, address buyer) external view returns(bool isPurchable);
    function exists(bytes32 projectId) external view returns (bool);
    function getAddressKey(bytes32 projectId, address user) external view returns (bytes32);
    function getProject(
        bytes32 id,
        uint32[] memory domainIds
    ) external view returns (
        PaymentDetails[] calldata paymentDetails,
        uint256 minimumSubscriptionSeconds,
        string calldata metadata,
        uint32 version,
        string[] calldata streams
    );

    // state changing functions
    function createProject(
        bytes32 id,
        uint32[] calldata domainIds,
        PaymentDetails[] calldata paymentDetails,
        uint minimumSubscriptionSeconds,
        bool isPublicPurchable,
        string calldata metadataJsonString
    ) external;
    function deleteProject(bytes32 projectId) external;
    function updateProject(
        bytes32 projectId,
        uint32[] calldata domainIds,
        PaymentDetails[] calldata paymentDetails,
        uint minimumSubscriptionSeconds,
        string calldata metadataJsonString
    ) external;

    // Subscription management functions

    // view functions
    function getSubscription(bytes32 projectId, address subscriber) external view returns (bool isValid, uint endTimestamp);
    function getOwnSubscription(bytes32 projectId) external view returns (bool isValid, uint endTimestamp);
    function hasValidSubscription(bytes32 projectId, address subscriber) external view returns (bool isValid);

    // state changing functions
    function grantSubscription(bytes32 projectId, uint subscriptionSeconds, address subscriber) external;

    // Streams Management functions

    // view functions
    function isStreamAdded(bytes32 projectId, string calldata streamId) external view returns (bool);

    // state changing functions
    function addStream(bytes32 projectId, string calldata streamId) external;
    function removeStream(bytes32 projectId, string memory streamId) external;

    // Permissions Management functions

    // view functions
    function hasPermissionType(bytes32 projectId, address user, PermissionType permissionType) external view returns (bool userhasPermissionType);

    // state changing functions
    function enablePermissionType(bytes32 projectId, address user, PermissionType permissionType) external;
    function transferPermissionType(bytes32 projectId, address recipient, PermissionType permissionType) external;
    function revokePermissionType(bytes32 projectId, address user, PermissionType permissionType) external;
    function getPermission(bytes32 projectId, address user) external view returns (Permission memory permission);
    function setPermissionBooleans(bytes32 projectId, address user, bool canBuy, bool deletePerm, bool canEdit, bool canGrant) external;
    function revokeAllPermissionsForUser(bytes32 projectId, address user) external;
    function setPermissionsForMultipleUsers(bytes32 projectId, address[] calldata users, Permission[] calldata permissions) external;
    function setPermissionsForMultipleProjects(bytes32[] calldata projectIds, address[][] calldata users, Permission[][] calldata permissions) external;
    function transferAllPermissionsToUser(bytes32 projectId, address recipient) external;

    // Trusted Role functions

    // view functions
    function getTrustedRole() external pure returns (bytes32);

    // state changing functions
    function trustedCreateProject(
        bytes32 id,
        uint32[] calldata domainIds,
        PaymentDetails[] calldata paymentDetails,
        uint256 minimumSubscriptionSeconds,
        address user,
        bool isPublicPurchable,
        string calldata metadataJsonString
    ) external;
    function trustedSetPermissions(
        bytes32 projectId,
        address user,
        bool canBuy,
        bool deletePerm,
        bool canEdit,
        bool canGrant
    ) external;
    function trustedSetPermissionsForMultipleProjects(
        bytes32[] calldata projectIds,
        address[] calldata users,
        Permission[] calldata permissions
    ) external;
}
