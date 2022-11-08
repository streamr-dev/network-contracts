import { ethers, upgrades } from "hardhat"

const { log } = console

/**
 * npx hardhat run --network [network name] scripts/deployContracts.ts
 */
async function main(network: string) {
    let uniswapV2RouterAddress: string

    switch (network) {
        case 'matic': {
            uniswapV2RouterAddress = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff'
            break
        }
        case 'xdai': {
            uniswapV2RouterAddress = '0x1C232F01118CB8B424793ae03F870aa7D0ac7f77'
            break
        }
        case 'dev': {
            uniswapV2RouterAddress = '0xeE1bC9a7BFF1fFD913f4c97B6177D47E804E1920' // local docker dev mainchain
            break
        }
        default: {
            uniswapV2RouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' // Ethereum mainnet, Ropsten, Rinkeby, Görli, Kovan 
        }
    }

    const Marketplace = await ethers.getContractFactory("MarketplaceV3")
    const marketplace = await upgrades.deployProxy(Marketplace, [], { kind: 'uups' })
    await marketplace.deployed()
    log(`MarketplaceV3 deployed at ${marketplace.address}`)

    const Uniswap2Adapter = await ethers.getContractFactory("Uniswap2Adapter")
    const uniswap2Adapter = await Uniswap2Adapter.deploy(marketplace.address, uniswapV2RouterAddress)
    await uniswap2Adapter.deployed()
    log(`Uniswap2Adapter deployed at ${uniswap2Adapter.address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main("dev").catch((error) => {
    console.error(error)
    process.exitCode = 1
})
