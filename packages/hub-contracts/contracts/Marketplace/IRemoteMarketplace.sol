// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

interface IRemoteMarketplace {
    struct ProjectPurchase {
        bytes32 projectId;
        address buyer;
        address subscriber;
        address beneficiary;
        address pricingTokenAddress;
        uint256 subscriptionSeconds;
        uint256 requestTimestamp;
        uint256 price;
        uint256 fee;
    }

    // purchase events
    event ProjectPurchasedFromRemote(bytes32 projectId, address subscriber, uint256 subscriptionSeconds, uint256 price, uint256 fee);

    // admin functions
    function addRecipient(uint32 _destinationDomainId, address _recipientContractAddress) external;

    // purchase functions
    function buy(bytes32 projectId, uint256 subscriptionSeconds) external;
    function buyFor(bytes32 projectId, uint256 subscriptionSeconds, address subscriber) external;

    // callback functions
    function handlePurchaseInfo(
        address beneficiary,
        address pricingTokenAddress,
        uint256 price,
        uint256 fee,
        uint256 purchaseId,
        uint256 streamsCount
    ) external;
    function handleSubscriptionState(
        bool isValid,
        uint256 subEndTimestamp,
        uint256 purchaseId
    ) external;

    receive() external payable;
    function withdraw(uint256 amount) external;
}
