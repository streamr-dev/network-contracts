/**
 * Deployed on gnosis on 2023-02-22
 * https://gnosisscan.io/address/0x023eaE17d3dd65F1e7b4daa355e6478719Bd2BEf
 */
 
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.13;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "../token/IERC677.sol";
import "./IPurchaseListener.sol";
import "./IMarketplaceV4.sol";
import "./IRemoteMarketplaceV1.sol";
import "./IMailbox.sol";
import "./IInterchainQueryRouter.sol";
import "./IInterchainGasPaymaster.sol";

/**
 * @title Streamr Remote Marketplace
 * The marketplace interface through which the users on other networks can send cross-chain messages to MarketpalceV4 (e.g. buy projects)
 */
contract RemoteMarketplaceV1 is Initializable, OwnableUpgradeable, UUPSUpgradeable, IRemoteMarketplaceV1 {

    uint256 public purchaseCount;
    mapping(uint256 => ProjectPurchase) public purchases;

    uint32 public originDomainId; // the domain id of the chain where RemoteMarketplaceV1 is deployed
    uint32 public destinationDomainId; // the domain id of the chain where ProjectRegistryV1 & MarketplaceV4 is deployed
    address public recipientAddress; // the address of the MarketplaceV4 contract on the destination chain
    IMailbox public mailbox;
    IInterchainQueryRouter public queryRouter;
    IInterchainGasPaymaster public gasPaymaster;

    modifier onlyQueryRouter() {
        require(msg.sender == address(queryRouter), "error_onlyQueryRouter");
        _;
    }

    /**
     * @param _originDomainId - the domain id of the chain this contract is deployed on
     * @param _queryRouter - hyperlane query router contract address. The same on all EVM chains
     * @param _mailboxAddress - hyperlane Mailbox contract address. The same on all EVM chains
     * @param _gasPaymaster - hyperlane paymaster contract address. The same on all EVM chains
     */
    function initialize(uint32 _originDomainId, address _queryRouter, address _mailboxAddress, address _gasPaymaster) public initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        originDomainId = _originDomainId;
        queryRouter = IInterchainQueryRouter(_queryRouter);
        mailbox = IMailbox(_mailboxAddress);
        gasPaymaster = IInterchainGasPaymaster(_gasPaymaster);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /**
     * Add recipient contract address for the destination chain; where the queries/messages are sent to
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
        uint256 purchaseId = ++purchaseCount;
        purchases[purchaseId] = ProjectPurchase(
            projectId,
            msg.sender, // buyer
            subscriber,
            address(0x0), // beneficiary
            address(0x0), // pricingTokenAddress
            subscriptionSeconds,
            // solhint-disable-next-line not-rely-on-time
            block.timestamp, // requestTimestamp
            0, // price
            0 // fee
        );
        _queryPurchaseInfo(projectId, subscriptionSeconds, purchaseId);
    }

    /**
     * Query the destination chain, using the interchain query router
     * The query will return the purchase informations (beneficiary, pricingTokenAddress, price, fee, streamsCount)
     * Pay the query gas fee to the interchain gas paymaster
     */
    function _queryPurchaseInfo(bytes32 projectId, uint256 subscriptionSeconds, uint256 purchaseId) private {
        bytes32 messageId = queryRouter.query(
            destinationDomainId,
            Call({to: recipientAddress, data: abi.encodeCall(IMarketplaceV4.getPurchaseInfo, (projectId, subscriptionSeconds, originDomainId, purchaseId))}),
            abi.encodePacked(this.handlePurchaseInfo.selector)
        );
        uint256 gasAmount = _estimateGasForQueryPurchaseInfo();
        _payInterchainGas(messageId, gasAmount, address(this));
    }

    /**
     * Recieve the purchase info from the destination chain. 
     * If the buyer has enough allowance to purchase the project, dispatch message to the destination chain and grant the subscription
     */
    function handlePurchaseInfo(
        address beneficiary,
        address pricingTokenAddress,
        uint256 price,
        uint256 fee,
        uint256 purchaseId,
        uint256 streamsCount
    ) external onlyQueryRouter {
        ProjectPurchase memory p = purchases[purchaseId];
        p.beneficiary = beneficiary;
        p.pricingTokenAddress = pricingTokenAddress;
        p.price = price;
        p.fee = fee;
        purchases[purchaseId] = p;

        IERC677 pricingToken = IERC677(pricingTokenAddress);
        require(pricingToken.allowance(p.buyer, address(this)) >= price, "error_insufficientAllowance");
        
        _dispatchPurchase(p.projectId, p.subscriber, p.subscriptionSeconds, streamsCount);
        _querySubscriptionState(p.projectId, p.subscriber, purchaseId);
    }

    /**
     * Send message to the destination chain, using the interchain mailbox. It will grant the subscription
     * Pay the message gas fee to the interchain gas paymaster
     */
    function _dispatchPurchase(bytes32 projectId, address subscriber, uint256 subscriptionSeconds, uint256 streamsCount) private {
        bytes32 messageId =  mailbox.dispatch(
            destinationDomainId,
            _addressToBytes32(recipientAddress),
            abi.encode(projectId, subscriber, subscriptionSeconds)
        );
        uint256 gasAmount = _estimateGasForDispatch(streamsCount);
        _payInterchainGas(messageId, gasAmount, address(this));
    }

    /**
     * Check if the subscription was extended. The query will return the subscription state (isValid, subEndTimestamp)
     * Pay the query gas fee to the interchain gas paymaster
     */
    function _querySubscriptionState(bytes32 projectId, address subscriber, uint256 purchaseId) private {
        bytes32 messageId = queryRouter.query(
            destinationDomainId,
            Call({to: recipientAddress, data: abi.encodeCall(IMarketplaceV4.getSubscriptionInfo, (projectId, subscriber, purchaseId))}),
            abi.encodePacked(this.handleSubscriptionState.selector)
        );
        uint256 gasAmount = _estimateGasForQuerySubscriptionState();
        _payInterchainGas(messageId, gasAmount, address(this));
    }

    /**
     * Subscription was extended on the destination chain
     * Transfer payment from buyer to marketplace; pay the beneficiary & the marketplace owner
     */
    function handleSubscriptionState(bool isValid, uint256 subEndTimestamp, uint256 purchaseId) external onlyQueryRouter {
        ProjectPurchase memory p = purchases[purchaseId];

        IERC677 pricingToken = IERC677(p.pricingTokenAddress);
        if (isValid && subEndTimestamp >= p.requestTimestamp + p.subscriptionSeconds) { // subscription was extended => buyers pays for the subscription
            // transfer price (amount to beneficiary + fee to marketplace owner) from buyer to marketplace
            require(pricingToken.transferFrom(p.buyer, address(this), p.price), "error_paymentFailed");

            try pricingToken.transferAndCall(p.beneficiary, p.price - p.fee, abi.encodePacked(p.projectId, p.subscriber, subEndTimestamp, p.price, p.fee)) returns (bool success) {
                require(success, "error_transferAndCallProject");
            } catch {
                // pricing token is NOT ERC677, so project beneficiary can only react to purchase by implementing IPurchaseListener
                require(pricingToken.transfer(p.beneficiary, p.price - p.fee), "error_paymentFailed");
            }

            if (p.fee > 0) {
                // pricing token is ERC677 and marketplace owner can react to project purchase
                try pricingToken.transferAndCall(owner(), p.fee, abi.encodePacked(p.projectId, p.subscriber, subEndTimestamp, p.price, p.fee)) returns (bool success) {
                    require(success, "error_transferAndCallFee");
                } catch {
                    // pricing token is NOT ERC677 and marketplace owner can NOT react to project purchase
                    require(pricingToken.transfer(owner(), p.fee), "error_paymentFailed");
                }
            }

            _notifyPurchaseListener(p.beneficiary, p.projectId, p.subscriber, subEndTimestamp, p.price, p.fee);
            emit ProjectPurchasedFromRemote(p.projectId, p.subscriber, p.subscriptionSeconds, p.price, p.fee);
        } else {
            // subscription was NOT extended => no payment is needed
        }

        delete purchases[purchaseId];
    }

    /**
     * Notify the purchase listener of project purchase
     * @param beneficiary is the project beneficiary (the address getting paid for project)
     * @dev if the beneficiary is a contract, it can implement IPurchaseListener to react to project purchase
     * @param subscriber is the address for which the project subscription is added/extended
    */
    function _notifyPurchaseListener(address beneficiary, bytes32 projectId, address subscriber, uint256 subEndTimestamp, uint256 price, uint256 fee) private {
        uint256 codeSize;
        assembly { codeSize := extcodesize(beneficiary) }  // solhint-disable-line no-inline-assembly
        if (codeSize > 0) {
            try IPurchaseListener(beneficiary).onPurchase(projectId, subscriber, subEndTimestamp, price, fee) returns (bool accepted) {
                require(accepted, "error_rejectedBySeller");
            } catch {
                // purchase listener not notified
            }
        }
    }

    /**
     * Helper function to estimate the gas amount needed for the recipient's getPurchaseInfo function
     */
    function _estimateGasForQueryPurchaseInfo() private pure returns (uint256) {
        uint256 gasAmount = 32877; // gas for getPurchaseInfo on destination chain
        gasAmount += 80000; // gas for query overhead (suggested on hyperlane docs)
        return gasAmount;
    }

    /**
     * Helper function to estimate the gas amount needed for the recipient's getSubscriptionState function
     */
    function _estimateGasForQuerySubscriptionState() private pure returns (uint256) {
        uint256 gasAmount = 25768; // gas for getSubscriptionState on destination chain
        gasAmount += 80000; // gas for query overhead (suggested on hyperlane docs)
        return gasAmount;
    }

    /**
     * Helper function to estimate the gas amount needed for the recipient's handle function
     */
    function _estimateGasForDispatch(uint256 streamsCount) private pure returns (uint256) {
        uint256 gasAmount = 69581; // gas to use by the recipient's handle function (projects without streams)
        if (streamsCount == 1) {
            gasAmount += 56673; // gas for the first stream
        }
        for (uint i = 1; i < streamsCount; i++) { // strart from index 1 to skip the first stream
            gasAmount += 43650; // gas for each additional stream
        }
        return gasAmount;
    }


    /**
     * @param messageId - the id of the message that is being paid for
     * @param gasAmount - the amount of gas that the message's recipient handle function will use at the destination
     * @dev The overhead gas amounts needed at destination (e.g. Mailbox/ISM) will be added automatically
     * @param refundAddress - the address where the exceeded gas amount will be sent to (anything over what quoteGasPayment returns)
     * @dev If a refund is unsuccessful, the payForGas call will revert.
     * @dev Refunding overpayment involves the IGP contract calling the _refundAddress, which can present a risk of reentrancy
     */
    function _payInterchainGas(bytes32 messageId, uint256 gasAmount, address refundAddress) private {
        uint256 quotedPayment = gasPaymaster.quoteGasPayment(destinationDomainId, gasAmount);
        gasPaymaster.payForGas{value: quotedPayment}(messageId, destinationDomainId, gasAmount, refundAddress);
    }

    function _addressToBytes32(address addr) private pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
    
    /**
     * Contract must be able to receive ETH for potential interchain payment refund
     */
    receive() external payable {}

    function withdraw(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "error_insufficientBalance");
        payable(msg.sender).transfer(amount);
    }
}
