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
        uint32 originDomainId,
        uint256 purchaseId
    ) external view returns(address, address, uint256, uint256, uint256);
}

struct Call {
    address to;
    bytes data;
}

interface IInterchainQueryRouter {
    function query(
        uint32 _destinationDomain,
        Call calldata call,
        bytes calldata callback
    ) external;
}

interface IOutbox {
    function dispatch(
        uint32 destinationDomainId, // the chain where MarketplaceV4 is deployed and where messages are sent to. It is a unique ID assigned by hyperlane protocol
        bytes32 recipientAddress, // the address for the MarketplaceV4 contract. It must have the handle() function
        bytes calldata messageBody // encoded purchase info
    ) external returns (uint256);
}

/**
 * @title Streamr Remote Marketplace
 * The marketplace interface through which the users on other networks can send cross-chain messages to MarketpalceV4 (e.g. buy projects)
 */
contract RemoteMarketplace is Ownable {
    struct PurchaseRequest {
        bytes32 projectId;
        address buyer;
        address subscriber;
        uint256 subscriptionSeconds;
    }

    uint256 public purchaseCount;
    mapping(uint256 => PurchaseRequest) public purchases;

    uint32 public originDomainId; // the domain id of the chain where RemoteMarketplace is deployed
    uint32 public destinationDomainId; // the domain id of the chain where ProjectRegistry & MarketplaceV4 is deployed
    address public recipientAddress; // the address of the MarketplaceV4 contract on the destination chain
    IInterchainQueryRouter public queryRouter;
    IOutbox public outbox;

    event CrossChainPurchase(bytes32 projectId, address subscriber, uint256 subscriptionSeconds, uint256 price, uint256 fee);
    event ProjectQuerySent(uint32 destinationDomainId, address recipientAddress, bytes32 projectId, uint256 subscriptionSeconds, uint256 purchaseId);
    event DispatchSubscribeToProject(uint32 destinationDomainId, address recipientAddress, bytes32 projectId, uint256 subscriptionSeconds, address subscriber);
    event QueryProjectReturned(address beneficiary, address pricingTokenAddress, uint256 price, uint256 fee, uint256 purchaseId);

    modifier onlyQueryRouter() {
        require(msg.sender == address(queryRouter), "error_onlyQueryRouter");
        _;
    }

    /**
     * @param _originDomainId - the domain id of the chain this contract is deployed on
     * @param _queryRouter - hyperlane query router for the origin chain
     * @param _outboxAddress - hyperlane core address for the chain where RemoteMarketplace is deployed
     */
    constructor(uint32 _originDomainId, address _queryRouter, address _outboxAddress) {
        originDomainId = _originDomainId;
        queryRouter = IInterchainQueryRouter(_queryRouter);
        outbox = IOutbox(_outboxAddress);
    }

    /**
     * @param _destinationDomainId - the domain id of the destination chain. It is a unique ID assigned by hyperlane protocol
     * @param _recipientContractAddress - the address of the recipient contract (e.g. MarketplaceV4)
     */
    function addRecipient(uint32 _destinationDomainId, address _recipientContractAddress) external onlyOwner {
        destinationDomainId = _destinationDomainId;
        recipientAddress = _recipientContractAddress;
    }

    function buy(bytes32 projectId, uint256 subscriptionSeconds) public {
        buyFor(projectId, subscriptionSeconds, msg.sender);
    }

    function buyFor(bytes32 projectId, uint256 subscriptionSeconds, address subscriber) public {
        uint256 purchaseId = purchaseCount + 1;
        purchaseCount = purchaseId;
        purchases[purchaseId] = PurchaseRequest(projectId, msg.sender, subscriber, subscriptionSeconds);
        _queryProject(projectId, subscriptionSeconds, purchaseId);
    }

    function handleQueryProjectResult(
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
        emit CrossChainPurchase(projectId, subscriber, subscriptionSeconds, price, fee);
        _subscribeToProject(projectId, subscriber, subscriptionSeconds, beneficiary, price, fee);
        _handleProjectPurchase(buyer, beneficiary, pricingTokenAddress, price, fee);

        emit QueryProjectReturned(beneficiary, pricingTokenAddress, price, fee, purchaseId);
    }

    function _queryProject(bytes32 projectId, uint256 subscriptionSeconds, uint256 purchaseId) private {
        queryRouter.query(
            destinationDomainId,
            Call({to: recipientAddress, data: abi.encodeCall(IMarketplace.getPurchaseInfo, (projectId, subscriptionSeconds, originDomainId, purchaseId))}),
            abi.encodePacked(this.handleQueryProjectResult.selector)
        );
        emit ProjectQuerySent(destinationDomainId, recipientAddress, projectId, subscriptionSeconds, purchaseId);
    }

    function _subscribeToProject(bytes32 projectId, address subscriber, uint256 subscriptionSeconds, address beneficiary, uint256 price, uint256 fee) private {
        emit DispatchSubscribeToProject(destinationDomainId, recipientAddress, projectId, subscriptionSeconds, subscriber);
        outbox.dispatch(
            destinationDomainId,
            _addressToBytes32(recipientAddress),
            abi.encode(projectId, subscriber, subscriptionSeconds, beneficiary, price, fee)
        );
    }

    function _handleProjectPurchase(address buyer, address beneficiary, address pricingTokenAddress, uint256 price, uint256 fee) private {
        IERC20 pricingToken = IERC20(pricingTokenAddress);
        require(pricingToken.transferFrom(buyer, beneficiary, price - fee), "error_projectPaymentFailed");
        if (fee > 0) {
            require(pricingToken.transferFrom(buyer, owner(), fee), "error_feePaymentFailed");
        }
    }

    function _addressToBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
