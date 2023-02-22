// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IMarketplaceV4.sol";

interface IProjectRegistry {
    struct PaymentDetails {
        address beneficiary; // account where revenue is directed to
        address pricingTokenAddress; // the token in which the project is paid to project beneficiary
        uint256 pricePerSecond;
    }
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
    function exists(bytes32 projectId) external view returns (bool);
    function isTrustedForwarder(address forwarder) external view returns (bool);
}

contract Uniswap2AdapterV4 is ERC2771Context {

    IMarketplaceV4 public marketplace;
    IProjectRegistry public projectRegistry;
    IUniswapV2Router02 public uniswapRouter;
    address public liquidityToken;
    uint32[] public domainIds; // assigned at contract creation

    /*
     * @dev ERC2771Context is initialised with zero address since the forwarder is handled by the project registry
     */
    constructor(address _marketplace, address _projectRegistry, address _uniswapRouter, uint32 _deployedOnDomainId) ERC2771Context(address(0x0)) {
        marketplace = IMarketplaceV4(_marketplace);
        projectRegistry = IProjectRegistry(_projectRegistry);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        domainIds.push(_deployedOnDomainId);
    }

    function _msgSender() internal view virtual override returns (address sender) {
        return super._msgSender();
    }

    function _msgData() internal view virtual override returns (bytes calldata) {
        return super._msgData();
    }

    /*
     * Override openzeppelin's ERC2771Context function
     * @dev isTrustedForwarder override and project registry role access adds trusted forwarder reset functionality
     */
    function isTrustedForwarder(address forwarder) public view override returns (bool) {
        return projectRegistry.isTrustedForwarder(forwarder);
    }

    function buyWithERC20(bytes32 projectId, uint minSubscriptionSeconds, uint timeWindow, address erc20Address, uint amount) public {
        require(erc20Address != address(0), "use buyWithETH instead");
        (uint pricePerSecond, address pricingTokenAddress) = _getPriceInfo(projectId);
        address subscriber = _msgSender();

        if (pricePerSecond == 0x0) {
            //subscription is free. return payment and subscribe
            marketplace.buyFor(projectId, minSubscriptionSeconds, subscriber);
            return;
        }

        IERC20 fromToken = IERC20(erc20Address);
        require(fromToken.transferFrom(subscriber, address(this), amount), "must pre approve token transfer");
        require(fromToken.approve(address(uniswapRouter), 0), "approval failed");
        require(fromToken.approve(address(uniswapRouter), amount), "approval failed");

        _buyWithUniswap(subscriber, projectId, minSubscriptionSeconds, timeWindow, pricePerSecond, amount, erc20Address, pricingTokenAddress);
    }

    function buyWithETH(bytes32 projectId, uint minSubscriptionSeconds, uint timeWindow) public payable {
        (uint pricePerSecond, address pricingTokenAddress) = _getPriceInfo(projectId);
        address subscriber = _msgSender();

        if (pricePerSecond == 0x0) {
            //subscription is free. return payment and subscribe
            if (msg.value > 0x0) {
                payable(subscriber).transfer(msg.value);
            }
            marketplace.buyFor(projectId, minSubscriptionSeconds, subscriber);
            return;
        }

        _buyWithUniswap(subscriber, projectId, minSubscriptionSeconds, timeWindow, pricePerSecond, msg.value, uniswapRouter.WETH(), pricingTokenAddress);
    }

    /**
     * Swap buyer tokens for project tokens and buy subscription seconds for the project
     * @param subscriber the address for which the subscription is extended
     * @param projectId the project id in bytes32
     * @param minSubscriptionSeconds minimum seconds received, without reverting the transaction
     * @param timeWindow the time window in which the transaction should be completed
     * @param amount the tokens paid for the subscription
     * @param fromToken the buyer's token. If equal with uniswapRouter.WETH(), it means ETH
     * @param toToken the project's token
     * @dev https://docs.uniswap.org/protocol/V2/reference/smart-contracts/router-02
     * @dev amountOutMin is generally retrieved from an oracle, but here it's set to 1 since subscription validation is done through minSubscriptionSeconds
     */
    function _buyWithUniswap(address subscriber, bytes32 projectId, uint minSubscriptionSeconds, uint timeWindow, uint pricePerSecond, uint amount, address fromToken, address toToken) internal{
        address[] memory path = _uniswapPath(fromToken, toToken); // An array of token addresses. path.length must be >= 2. Pools for each consecutive pair of addresses must exist and have liquidity.
        uint deadline = block.timestamp + timeWindow; // Unix timestamp after which the transaction will revert.

        // swapExactETHForTokens/swapExactTokensForTokens returns the input token amount and all subsequent output token amounts.
        uint receivedTokens;
        if (fromToken == address(uniswapRouter.WETH())) {
            receivedTokens = uniswapRouter.swapExactETHForTokens{ value: amount }(1, path, address(this), deadline)[path.length - 1];
        }
        else {
            receivedTokens = uniswapRouter.swapExactTokensForTokens(amount, 1, path, address(this), deadline)[path.length - 1];
        }

        uint subscriptionSeconds = receivedTokens / pricePerSecond;
        require(subscriptionSeconds >= minSubscriptionSeconds, "error_minSubscriptionSeconds");

        require(IERC20(toToken).approve(address(marketplace), receivedTokens), "approval failed");
        marketplace.buyFor(projectId, subscriptionSeconds, subscriber);
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
     * If the data bytes contains a project id, the subscription is extended for that project
     * @dev The amount transferred is in pricingTokenAddress.
     * @dev msg.sender is the contract which supports ERC677.
     * @param sender The EOA initiating the transaction through transferAndCall.
     * @param amount The amount to be transferred (in wei).
     * @param data The extra data to be passed to the contract. Contains the project id.
     */
    function onTokenTransfer(address sender, uint amount, bytes calldata data) external {
        require(data.length == 32, "error_badProjectId");
        
        bytes32 projectId;
        assembly { projectId := calldataload(data.offset) } // solhint-disable-line no-inline-assembly

        IERC20 fromToken = IERC20(_msgSender());
        require(fromToken.approve(address(uniswapRouter), 0), "approval failed");
        require(fromToken.approve(address(uniswapRouter), amount), "approval failed"); // current contract has amount tokens and can approve the router to spend them

        (uint pricePerSecond, address pricingTokenAddress) = _getPriceInfo(projectId);

        address[] memory path = _uniswapPath(_msgSender(), pricingTokenAddress);
        uint receivedTokens = uniswapRouter.swapExactTokensForTokens(amount, 1, path, address(this), block.timestamp + 86400)[path.length - 1];

        require(IERC20(pricingTokenAddress).approve(address(marketplace), 0), "approval failed");
        require(IERC20(pricingTokenAddress).approve(address(marketplace), receivedTokens), "approval failed");
        uint subscriptionSeconds = receivedTokens / pricePerSecond;
        marketplace.buyFor(projectId, subscriptionSeconds, sender);
    }

    function _getPriceInfo(bytes32 projectId) internal view returns (uint256 pricePerSecond, address pricingTokenAddress) {
        require(projectRegistry.exists(projectId), "error_projectDoesNotExist");
        (IProjectRegistry.PaymentDetails[] memory paymentDetails, , , , ) = projectRegistry.getProject(projectId, domainIds);
        pricePerSecond = paymentDetails[0].pricePerSecond;
        pricingTokenAddress = paymentDetails[0].pricingTokenAddress;
        return (pricePerSecond, pricingTokenAddress);
    }
}
