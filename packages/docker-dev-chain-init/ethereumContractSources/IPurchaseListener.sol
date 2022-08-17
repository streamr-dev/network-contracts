
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

// TODO: use IERC677Receiver instead
interface IPurchaseListener {
	// TODO: find out about how to best detect who implements an interface
	//   see at least https://github.com/ethereum/EIPs/blob/master/EIPS/eip-165.md
	// function isPurchaseListener() external returns (bool);

	/**
	 * Similarly to ETH transfer, returning false will decline the transaction
	 *   (declining should probably cause revert, but that's up to the caller)
	 * IMPORTANT: include onlyMarketplace modifier to your implementations!
	 */
	function onPurchase(
		bytes32 productId,
		address subscriber,
		uint256 endTimestamp,
		uint256 priceDatacoin,
		uint256 feeDatacoin
	) external returns (bool accepted);
}