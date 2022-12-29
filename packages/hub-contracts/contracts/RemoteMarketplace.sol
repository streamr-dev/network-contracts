// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMarketplace {
    function buy(bytes32 projectId, uint256 subscriptionSeconds) external;
    function buyFor(bytes32 projectId, uint256 subscriptionSeconds, address recipient) external;
    function getPurchaseInfo(
        bytes32 projectId,
        uint256 subscriptionSeconds,
        uint32[] memory originDomainId,
        uint256 purchaseId
    ) external view returns(address, address, uint256, uint256, uint256);
}

interface IInterchainQueryRouter {
    struct Call {
        address to;
        bytes data;
    }
    function query(
        uint32 destinationDomainId,
        Call calldata call,
        bytes calldata callback
    ) external returns (uint256);
}

interface IOutbox {
    function dispatch(
        uint32 destinationDomainId, // the chain where MarketplaceV4 is deployed and where messages are sent to. It is a unique ID assigned by hyperlane protocol (e.g. on polygon)
        bytes32 recipientAddress, // the address for the MarketplaceV4 contract. It must have the handle() function (e.g. on polygon)
        bytes calldata messageBody // encoded purchase info
    ) external returns (uint256);
}

/**
 * @title Streamr Remote Marketplace
 * The Remmote Marketplace through which the users on other networks can send cross-chain messages (e.g. buy projects)
 */
contract RemoteMarketplace is Ownable {
    struct PurchaseRequest {
        bytes32 projectId;
        address buyer;
        address subscriber;
        uint256 subscriptionSeconds;
    }

    uint256 public purchaseCount;
    mapping(uint256 => PurchaseRequest) purchases;

    uint32[] public originDomainId; // contains only one element (the domain id of the chain where RemoteMarketplace is deployed)
    uint32 public destinationDomainId; // the domain id of the chain where MarketplaceV4 is deployed
    address public recipientAddress; // the address of the MarketplaceV4 contract on the destination chain
    IInterchainQueryRouter public queryRouter;
    IOutbox public outbox;

    event CrossChainPurchase(bytes32 projectId, address subscriber, uint256 subscriptionSeconds, uint256 price, uint256 fee);

    modifier onlyQueryRouter() {
        require(msg.sender == address(queryRouter), "error_onlyQueryRouter");
        _;
    }

    /**
     * @param _destinationDomainId - the domain id of the destination chain assigned by the protocol (e.g. polygon)
     * @param _recipientAddress - the address of the recipient contract (e.g. MarketplaceV4 on polygon)
     * @param _queryRouter - hyperlane query router for the origin chain
     * @param _outboxAddress - hyperlane core address for the chain where RemoteMarketplace is deployed (e.g. gnosis)
     */
    constructor(uint32 _domainId, uint32 _destinationDomainId, address _recipientAddress, address _queryRouter, address _outboxAddress) {
        originDomainId.push(_domainId);
        destinationDomainId = _destinationDomainId;
        recipientAddress = _recipientAddress;
        outbox = IOutbox(_outboxAddress);
        queryRouter = IInterchainQueryRouter(_queryRouter);
    }

    function buy(bytes32 projectId, uint256 subscriptionSeconds) public {
        buyFor(projectId, subscriptionSeconds, msg.sender);
    }

    function buyFor(bytes32 projectId, uint256 subscriptionSeconds, address subscriber) public {
        uint256 purchaseId = purchaseCount + 1;
        purchaseCount = purchaseId;
        queryRouter.query(
            destinationDomainId,
            IInterchainQueryRouter.Call({
                to: recipientAddress,
                data: abi.encodeCall(IMarketplace.getPurchaseInfo, (projectId, subscriptionSeconds, originDomainId, purchaseCount))
            }),
            abi.encodePacked(this.handleQueryProject.selector)
        );
        purchases[purchaseId] = PurchaseRequest(projectId, msg.sender, subscriber, subscriptionSeconds);
    }

    function handleQueryProject(
        address beneficiary,
        address pricingTokenAddress,
        uint256 price,
        uint256 fee,
        uint256 purchaseId
    ) public { // onlyQueryRouter
        PurchaseRequest memory purchase = purchases[purchaseId];
        bytes32 projectId = purchase.projectId;
        address buyer = purchase.buyer;
        address subscriber = purchase.subscriber;
        uint256 subscriptionSeconds = purchase.subscriptionSeconds;
        _handleProjectPurchase(buyer, beneficiary, pricingTokenAddress, price, fee);
        _subscribeToProject(projectId, subscriber, subscriptionSeconds);
        emit CrossChainPurchase(projectId, subscriber, subscriptionSeconds, price, fee);
    }

    function _handleProjectPurchase(
            address buyer,
            address beneficiary,
            address pricingTokenAddress,
            uint256 price,
            uint256 fee
        ) private {
        // require(price > 0, "error_freeProjectsNotSupportedOnRemoteMarketplace");
        IERC20 pricingToken = IERC20(pricingTokenAddress);
        require(pricingToken.transferFrom(buyer, beneficiary, price - fee), "error_projectPaymentFailed");
        if (fee > 0) {
            require(pricingToken.transferFrom(buyer, owner(), fee), "error_feePaymentFailed");
        }
    }

    function _subscribeToProject(bytes32 projectId, address subscriber, uint256 subscriptionSeconds) private {
        outbox.dispatch(
            destinationDomainId,
            _addressToBytes32(recipientAddress),
            abi.encode(projectId, subscriptionSeconds, subscriber)
        );
    }

    function _addressToBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
