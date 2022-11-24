// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IProjectRegistry {
    struct Project {
        bytes32 id;
        address beneficiary;        // account where revenue is directed to
        uint pricePerSecond;
        address pricingTokenAddress;  // the token in which the product is paid to product beneficiary
        uint minimumSubscriptionSeconds;
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
    event ProjectCreated(bytes32 indexed id, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds, string metadata);
    event ProjectUpdated(bytes32 indexed id, address beneficiary, uint pricePerSecond, address pricingTokenAddress, uint minimumSubscriptionSeconds, string metadata);
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
    function getProject(
        bytes32 id
    ) external view returns (
        address beneficiary,
        uint pricePerSecond,
        address pricingTokenAddress,
        uint minimumSubscriptionSeconds,
        string calldata metadata,
        uint32 version,
        string[] calldata streams
    );

    function createProject(
        bytes32 id,
        address beneficiary,
        uint pricePerSecond,
        address pricingTokenAddress,
        uint minimumSubscriptionSeconds,
        bool isPublicPurchable,
        string calldata metadataJsonString
    ) external;
}
