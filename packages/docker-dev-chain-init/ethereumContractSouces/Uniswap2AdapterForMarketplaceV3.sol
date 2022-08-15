// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; // TODO: remove

import "./IMarketplace.sol";
import "hardhat/console.sol";

contract Uniswap2AdapterForMarketplaceV3 {

    IMarketplace public marketplace;
    IUniswapV2Router02 public uniswapRouter;
    address public liquidityToken; // TODO: how is this initiated?

    constructor(address _marketplace, address _uniswapRouter) {
        marketplace = IMarketplace(_marketplace);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
    }

    function _getPriceInfo(bytes32 productId) internal view returns (uint, address) {
        (, address owner,, uint pricePerSecond, address pricingTokenAddress,,,) = marketplace.getProduct(productId);
        require(owner != address(0), "not found");
        return (pricePerSecond, pricingTokenAddress);
    }

    function buyWithERC20(bytes32 productId, uint minSubscriptionSeconds,uint timeWindow, address erc20_address, uint amount) public {
        require(erc20_address != address(0), "use buyWithETH instead");
        (uint pricePerSecond, address pricingTokenAddress) = _getPriceInfo(productId);

        if (pricePerSecond == 0x0) {
            //subscription is free. return payment and subscribe
            marketplace.buyFor(productId, minSubscriptionSeconds, msg.sender);
            return;
        }

        IERC20 fromToken = IERC20(erc20_address);
        require(fromToken.transferFrom(msg.sender, address(this), amount), "must pre approve token transfer");
        require(fromToken.approve(address(uniswapRouter), 0), "approval failed");
        require(fromToken.approve(address(uniswapRouter), amount), "approval failed");

        _buyWithUniswap(productId, minSubscriptionSeconds, timeWindow, pricePerSecond, amount, erc20_address, pricingTokenAddress);
    }

    function buyWithETH(bytes32 productId, uint minSubscriptionSeconds,uint timeWindow) public payable{
        (uint pricePerSecond, address pricingTokenAddress) = _getPriceInfo(productId);

        if (pricePerSecond == 0x0) {
            //subscription is free. return payment and subscribe
            if (msg.value > 0x0) {
                payable(msg.sender).transfer(msg.value);
            }
            marketplace.buyFor(productId, minSubscriptionSeconds, msg.sender);
            return;
        }

        _buyWithUniswap(productId, minSubscriptionSeconds, timeWindow, pricePerSecond, msg.value, uniswapRouter.WETH(), pricingTokenAddress);
    }

    /**
     * Swap buyer tokens for product tokens and buy subscription seconds for the product
     * @param productId the product id in bytes32
     * @param minSubscriptionSeconds minimum seconds received, without reverting the transaction
     * @param timeWindow the time window in which the transaction should be completed
     * @param amount the tokens paid for the subscription
     * @param fromToken the buyer's token. If equal with uniswapRouter.WETH(), it means ETH
     * @param toToken the product's token
     * @dev https://docs.uniswap.org/protocol/V2/reference/smart-contracts/router-02
     */
    function _buyWithUniswap(bytes32 productId, uint minSubscriptionSeconds, uint timeWindow, uint pricePerSecond, uint amount, address fromToken, address toToken) internal{
        // TODO: amountOutMin must be retrieved from an oracle of some kind
        uint amountOutMin = 1; // The minimum amount of output tokens that must be received for the transaction not to revert.
        address[] memory path = _uniswapPath(fromToken, toToken); // An array of token addresses. path.length must be >= 2. Pools for each consecutive pair of addresses must exist and have liquidity.
        address to = address(this); // Recipient of the output tokens.
        uint deadline = block.timestamp + timeWindow; // Unix timestamp after which the transaction will revert.

        // swapExactETHForTokens/swapExactTokensForTokens returns the input token amount and all subsequent output token amounts.
        uint receivedTokens;
        if (fromToken == address(uniswapRouter.WETH())) {
            receivedTokens = uniswapRouter.swapExactETHForTokens{ value: amount }(amountOutMin, path, to, deadline)[path.length - 1];
        }
        else {
            receivedTokens = uniswapRouter.swapExactTokensForTokens(amount, amountOutMin, path, to, deadline)[path.length - 1];
        }

        uint subscriptionSeconds = receivedTokens / pricePerSecond;
        require(subscriptionSeconds >= minSubscriptionSeconds, "error_minSubscriptionSeconds");

        require(IERC20(toToken).approve(address(marketplace), receivedTokens), "approval failed");
        marketplace.buyFor(productId, subscriptionSeconds, msg.sender); // TODO: use _msgSender for GSN compatibility
    }

    function _uniswapPath(address fromCoin, address toCoin) internal view returns (address[] memory path) {
        if (liquidityToken == address(0)) {
            //no intermediate
            path = new address[](2);
            path[0] = fromCoin;
            path[1] = toCoin;
            return path;
        }
        //use intermediate liquidity token
        path = new address[](3);
        path[0] = fromCoin;
        path[1] = liquidityToken;
        path[2] = toCoin;
        return path;
    }

    /**
     * ERC677 token callback
     * If the data bytes contains a product id, the subscription is extended for that product
     * @dev The amount transferred is in pricingTokenAddress.
     * @dev msg.sender is the contract which supports ERC677.
     * @param sender The EOA initiating the transaction through transferAndCall.
     * @param amount The amount to be transferred (in wei).
     * @param data The extra data to be passed to the contract. Contains the product id.
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        require(data.length == 32, "error_badProductId");
        
        bytes32 productId;
        assembly { productId := calldataload(data.offset) } // solhint-disable-line no-inline-assembly

        IERC20 fromToken = IERC20(msg.sender);
        require(fromToken.approve(address(uniswapRouter), 0), "approval failed");
        require(fromToken.approve(address(uniswapRouter), amount), "approval failed"); // current contract has amount tokens and can approve the router to spend them

        (uint pricePerSecond, address pricingTokenAddress) = _getPriceInfo(productId);

        address[] memory path = _uniswapPath(msg.sender, pricingTokenAddress);
        uint receivedTokens = uniswapRouter.swapExactTokensForTokens(amount, 1, path, address(this), block.timestamp + 86400)[path.length - 1];

        require(IERC20(pricingTokenAddress).approve(address(marketplace), 0), "approval failed");
        require(IERC20(pricingTokenAddress).approve(address(marketplace), receivedTokens), "approval failed");
        uint subscriptionSeconds = receivedTokens / pricePerSecond;
        marketplace.buyFor(productId, subscriptionSeconds, sender);
    }
}
