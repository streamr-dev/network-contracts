// const fs = require("fs")
// const Web3 = require("web3")
const { ethers, upgrades } = require('hardhat')

const products = require('./products.json')

const chainURL = process.env.CHAIN_URL || "http://10.200.10.1:8545"
const { log } = console
const defaultPrivateKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"

async function getProducts() {
    return products
}

async function smartContractInitialization() {

    const newWallet = new ethers.Wallet(defaultPrivateKey, new ethers.providers.JsonRpcProvider(chainURL))
    log("Deploy MarketplaceV3 on mainchain:")
    const marketV3Deployer = await ethers.getContractFactory("MarketplaceV3", newWallet)
    const marketV3DeployTx = await upgrades.deployProxy(marketV3Deployer, [], {
        kind: 'uups'
    })
    const marketV3DeployTxStr = await marketV3DeployTx.deployed()
    log(`MarketplaceV3 deployed on mainchain at ${marketV3DeployTxStr.address}`)

    log(`Deploying Uniswap2AdaptorForMarketplaceV3 contract from ${newWallet.address}`)
    const Uniswap2AdaptorDeployer = await ethers.getContractFactory("Uniswap2Adapter", newWallet)
    // const uniswap2AdaptorDeployTx = await Uniswap2AdaptorDeployer.deploy(marketV3DeployTxStr.address, router.address)
    const uniswap2AdaptorDeployTx = await Uniswap2AdaptorDeployer.deploy(marketV3DeployTxStr.address, "0xeE1bC9a7BFF1fFD913f4c97B6177D47E804E1920")
    const Uniswap2Adaptor = await uniswap2AdaptorDeployTx.deployed()
    log(`Uniswap2Adaptor for MarketplaceV3 deployed on mainchain at ${Uniswap2Adaptor.address}`)
    
    log("Loading test products from core")
    let products
    try {
        products = await getProducts()
    } catch (e) {
        console.error(e)
        process.exit(1)
    }

    log(`Adding ${products.length} products to Marketplace`)
    for (const p of products) {
        // free products not supported
        if (p.pricePerSecond == 0) {
            continue
        }
        log(`create ${p.id}`)
        const productIdbytes = `0x${p.id}`
        const pricingTokenAddress = `0xbAA81A0179015bE47Ad439566374F2Bae098686F` // DATAv2
        const txV3 = await marketV3DeployTxStr.createProduct(productIdbytes, p.name, newWallet.address, p.pricePerSecond, 
            pricingTokenAddress, p.minimumSubscriptionInSeconds)
        await txV3.wait()
        if (p.state == "NOT_DEPLOYED") {
            log(`delete ${p.id}`)
            await (await marketV3DeployTxStr.deleteProduct(productIdbytes)).wait()
        }
    }
    log("marketplace address from adapter: ", await Uniswap2Adaptor.marketplace())
}

smartContractInitialization()
