import fetch from 'node-fetch'
import { waffle, ethers, upgrades } from 'hardhat'
import { BigNumber, Overrides, providers, utils, Wallet } from 'ethers'
import { MarketplaceV3, Uniswap2Adapter, IERC20, DATAv2, IUniswapV2Router02, StreamRegistryV4 } from '../typechain'
import { config } from '@streamr/config'

import * as WETH9Json from '@uniswap/v2-periphery/build/WETH9.json'
import * as UniswapV2FactoryJson from '@uniswap/v2-core/build/UniswapV2Factory.json'
import * as UniswapV2Router02Json from '@uniswap/v2-periphery/build/UniswapV2Router02.json'
import * as TestTokenJson from '../test-contracts/TestToken.json'
import StreamrClient from 'streamr-client'

const { parseEther, id, formatEther, parseUnits } = utils

const {
    CHAIN = 'dev0',
    POLYGON = "dev1",
    ADMIN: PRODUCT_ADMIN_KEY = '0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297',
    BUYER: BUYER_KEY = '0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9',
    STREAMR_API_URL = 'http://10.200.10.1/api/v2',
} = process.env

const {
    rpcEndpoints: [{
        url: ETHEREUM_RPC_URL
    }],
    contracts: {
        DATA: DATA_V2_ADDRESS,
        Uniswap2Router: UNISWAP_V2_ROUTER_02_ADDRESS,
        MarketplaceV3: MARKETPLACE_V3_ADDRESS,
        Uniswap2AdapterForMarketplaceV3: UNISWAP_2_ADAPTER_ADDRESS,
    }
} = (config as any)[CHAIN]

const {
    rpcEndpoints: [{
        url: POLYGON_RPC_URL
    }],
    contracts: {
        StreamRegistry: STREAM_REGISTRY_ADDRESS,
    }
} = (config as any)[POLYGON]

const DEFAULT_PRIVATE_KEY = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const DEPLOYMENT_OWNER_KEY = '0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae'

// PRELOADED ADDRESSES
const OTHER_TOKEN_ADDRESS = DATA_V2_ADDRESS // "0xbAA81A0179015bE47Ad439566374F2Bae098686F"
// const UNISWAP_V2_FACTORY_ADDRESS = "0xbd2Ebafc70CCf41A44f5e03EDfD6F5527B5EfA29"

const { log } = console

let market: any
let uniswap2Adapter: Uniswap2Adapter
let uniswapRouter: IUniswapV2Router02
let uniswapFactory
let streamRegistry: StreamRegistryV4
let wallet: Wallet
let buyerWallet: Wallet
let adminWallet: Wallet
let adminPolygonWallet: Wallet
let deploymentOwner: Wallet
let dataTokenContract: DATAv2
let otherTokenContract: IERC20

const connectToAllContracts = async () => {
    const provider = new providers.JsonRpcProvider(ETHEREUM_RPC_URL)
    const polygonProvider = new providers.JsonRpcProvider(POLYGON_RPC_URL)
    deploymentOwner = new Wallet(DEPLOYMENT_OWNER_KEY, provider) // deployed by this wallet: marketplace, adapter
    wallet = new Wallet(DEFAULT_PRIVATE_KEY, provider) // deployed by this wallet: WETH, uniswapFactory, uniswapRouter, DATAv2, otherToken
    adminWallet = new Wallet(PRODUCT_ADMIN_KEY, provider) // hasn't hopefully done much anything yet
    buyerWallet = new Wallet(BUYER_KEY, provider) // hasn't hopefully done much anything yet
    adminPolygonWallet = new Wallet(PRODUCT_ADMIN_KEY, polygonProvider)
    log("Product creator/admin: ", adminWallet.address)
    log("Product buyer: ", buyerWallet.address)

    const marketplaceFactory = await ethers.getContractFactory('MarketplaceV3', wallet)
    const marketplace = await marketplaceFactory.attach(MARKETPLACE_V3_ADDRESS)
    const marketplaceContract = await marketplace.deployed()
    market = marketplaceContract.connect(wallet)
    log(`MarketplaceV3 deployed at ${marketplaceContract.address}`)

    if (UNISWAP_2_ADAPTER_ADDRESS) {
        const uniswap2AdapterFactory = await ethers.getContractFactory('Uniswap2Adapter', wallet)
        const uniswap2AdapterTx = await uniswap2AdapterFactory.attach(UNISWAP_2_ADAPTER_ADDRESS)
        const uniswap2AdapterContract = await uniswap2AdapterTx.deployed()
        log(`Uniswap2Adapter deployed at ${uniswap2AdapterContract.address}`)
        uniswap2Adapter = uniswap2AdapterContract.connect(wallet) as Uniswap2Adapter
    } else {
        log("No Uniswap2AdapterForMarketplaceV3 found for chain " + CHAIN)
    }

    if (UNISWAP_V2_ROUTER_02_ADDRESS) {
        const uniswap02Router02Factory = await ethers.getContractFactory(UniswapV2Router02Json.abi, UniswapV2Router02Json.bytecode, wallet)
        const uniswap02Router02Tx = await uniswap02Router02Factory.attach(UNISWAP_V2_ROUTER_02_ADDRESS)
        const uniswap02Router02Contract = await uniswap02Router02Tx.deployed()
        log(`Uniswap02Router02 deployed at ${uniswap02Router02Contract.address}`)
        uniswapRouter = uniswap02Router02Contract.connect(wallet) as IUniswapV2Router02
    } else {
        log("No Uniswap2Router found for chain " + CHAIN)
    }

    const dataTokenFactory = await ethers.getContractFactory("DATAv2", wallet)
    const dataTokenFactoryTx = await dataTokenFactory.attach(DATA_V2_ADDRESS)
    dataTokenContract = await dataTokenFactoryTx.deployed() as DATAv2
    log(`DATAv2 deployed at ${dataTokenContract.address}`)
    const dataAmount = await dataTokenContract.balanceOf(buyerWallet.address)
    log(`DATAv2 balance of ${buyerWallet.address}: ${dataAmount} (${formatEther(dataAmount)})`)

    const otherTokenFactory = await ethers.getContractFactory(TestTokenJson.abi, TestTokenJson.bytecode, wallet)
    const otherTokenFactoryTx = await otherTokenFactory.attach(OTHER_TOKEN_ADDRESS)
    otherTokenContract = await otherTokenFactoryTx.deployed() as IERC20
    log(`DATAv2 deployed at ${otherTokenContract.address}`)

    const streamRegistryFactory = await ethers.getContractFactory('StreamRegistryV4', adminPolygonWallet)
    streamRegistry = await streamRegistryFactory.attach(STREAM_REGISTRY_ADDRESS) as StreamRegistryV4
    await streamRegistry.deployed()

    // log("Uniswap has liquidity for pair DATA/OtherToken:")
    // const uniswapV2Factory = await ethers.getContractFactory(UniswapV2FactoryJson.abi, UniswapV2FactoryJson.bytecode, wallet)
    // uniswapFactory = await uniswapV2Factory.attach(UNISWAP_V2_FACTORY_ADDRESS)
    // log(`   - (${DATA_V2_ADDRESS}/${OTHER_TOKEN_ADDRESS}) liquidity pair: ${await uniswapFactory.getPair(DATA_V2_ADDRESS, OTHER_TOKEN_ADDRESS)}`)
}

const connectToAllContractsToHardhat = async () => {
    const { provider } = waffle
    const [defaultAccount, deployerAccount] = provider.getWallets()

    wallet = new Wallet(defaultAccount, provider) // deployed by this wallet: WETH, uniswapFactory, uniswapRouter, DATAv2, otherToken
    deploymentOwner = new Wallet(deployerAccount, provider) // deployed by this wallet: marketplace, adapter

    log("Deploy MarketplaceV3:")
    const marketplaceFactory = await ethers.getContractFactory('Marketplace', wallet)
    const marketFactoryTx = await upgrades.deployProxy(marketplaceFactory, [], { kind: 'uups' })
    market = await marketFactoryTx.deployed() as MarketplaceV3
    log(`   - deployed at: ${market.address}`)

    log("Deploy Uniswap2Factory:")
    const uniswapV2Factory = await ethers.getContractFactory(UniswapV2FactoryJson.abi, UniswapV2FactoryJson.bytecode, wallet)
    uniswapFactory = await uniswapV2Factory.deploy(wallet.address)
    log('   - deployed at: ', uniswapFactory.address)

    log("Deploy WETH:")
    const wethFactory = await ethers.getContractFactory(WETH9Json.abi, WETH9Json.bytecode, wallet)
    const weth = await wethFactory.deploy()
    log('   - deployed at: ', weth.address)

    log("Deploy Uniswap02Router02:")
    const uniswapRouterFactory = await ethers.getContractFactory(UniswapV2Router02Json.abi, UniswapV2Router02Json.bytecode, wallet)
    uniswapRouter = await uniswapRouterFactory.deploy(uniswapFactory.address, weth.address) as IUniswapV2Router02
    log(`   - deployed at: ${uniswapRouter.address}`)

    log("Deploy Uniswap2Adapter:")
    const uniswap2AdapterFactory = await ethers.getContractFactory('Uniswap2Adapter', wallet)
    uniswap2Adapter = await uniswap2AdapterFactory.deploy(market.address, uniswapRouter.address) as Uniswap2Adapter
    log(`   - deployed at: ${uniswap2Adapter.address}`)

    log("Deploy DATAv2:")
    const dataTokenFactory = await ethers.getContractFactory("DATAv2", wallet)
    dataTokenContract = await dataTokenFactory.deploy() as DATAv2
    log(`   - deployed at: ${dataTokenContract.address}`)
    log(`   - grant MINTER_ROLE to wallet (${wallet.address})`)
    await(await dataTokenContract.grantRole(id("MINTER_ROLE"), wallet.address)).wait()
    log(`   - mint 1,000,000 DATA to wallet (${wallet.address})`)
    const mintTokenAmount = parseEther("1000000")
    await (await dataTokenContract.mint(wallet.address, mintTokenAmount)).wait()
    log(`   - wallet has ${await dataTokenContract.balanceOf(wallet.address)} DATA`)
    log(`   - mint 1,000,000 DATA to deploymentOwner (${deploymentOwner.address})`)
    await (await dataTokenContract.mint(deploymentOwner.address, mintTokenAmount)).wait()
    log(`   - deployment owner has ${await dataTokenContract.balanceOf(deploymentOwner.address)} DATA`)

    log("Deploy OtherToken:")
    const otherTokenFactory = await ethers.getContractFactory(TestTokenJson.abi, TestTokenJson.bytecode, wallet)
    // the OtherToken contract automatically mints 100,000 tokens to the deployer
    otherTokenContract = await otherTokenFactory.deploy("OtherToken", "OTK") as IERC20
    log(`   - deployed at ${otherTokenContract.address}`)
    log(`   - wallet has ${await otherTokenContract.balanceOf(wallet.address)} OtherTokens`)

    log("Add liquidity to Uniswap:")
    const dataAmount = parseEther("1000")
    const otherAmount = parseEther("10000")
    const deadline = 2525000000 // epoch time for year 2050
    log("   - approve uniswap to spend DATA and OtherToken")
    const dataBalance = await dataTokenContract.balanceOf(wallet.address)
    const otherBalance = await otherTokenContract.balanceOf(wallet.address)
    log(`    - wallet has ${dataBalance} DATA and ${otherBalance} OtherTokens`)
    await dataTokenContract.approve(uniswapRouter.address, dataAmount)
    await otherTokenContract.approve(uniswapRouter.address, otherAmount)
    log(`    - router DATA allowance: ${await dataTokenContract.allowance(wallet.address, uniswapRouter.address)}`)
    log(`    - router OtherToken allowance: ${await otherTokenContract.allowance(wallet.address, uniswapRouter.address)}`)
    const tx = await uniswapRouter.addLiquidity(
        dataTokenContract.address,
        otherTokenContract.address,
        dataAmount,
        otherAmount,
        0,
        0,
        wallet.address,
        deadline
    )
    await tx.wait()
    log("   - liquidity added")
    log(`   - DATA/OtherToken liquidity pair added: ${await uniswapFactory.getPair(dataTokenContract.address, otherTokenContract.address)}`)
}

async function getEthersOverrides(chainName?: string): Promise<Overrides> {
    const ethersOverrides: Overrides = {}
    if ((chainName ?? CHAIN) === "polygon") {
        log("    Querying Polygon Gas Station for gas prices")
        // example response: {
        //   "safeLow":{"maxPriorityFee":30.639746665266667,"maxFee":30.63974668026667},
        //   "standard":{"maxPriorityFee":33.7182337732,"maxFee":33.718233788199996},
        //   "fast":{"maxPriorityFee":46.24675554826667,"maxFee":46.24675556326667},
        //   "estimatedBaseFee":1.5e-8,"blockTime":2,"blockNumber":33293051
        //}
        const response = await fetch("https://gasstation-mainnet.matic.network/v2")
        const fees: any = await response.json()
        log("    %o", fees)

        ethersOverrides.maxFeePerGas = parseUnits(Math.ceil(fees.standard.maxFee).toString(), "gwei")
        ethersOverrides.maxPriorityFeePerGas = parseUnits(Math.ceil(fees.standard.maxPriorityFee).toString(), "gwei")
    }
    return ethersOverrides
}

const createProduct = async (pricingTokenAddress = dataTokenContract.address): Promise<string> => {
    log('Create product')
    const productName = `Test create product (${Math.floor(Math.random() * 1000000)})`
    const beneficiaryAddress = adminWallet.address
    const streamIdPath = "/test" + Date.now()
    const streamId = adminWallet.address.toLowerCase() + streamIdPath

    const streamTx = await streamRegistry.createStream(streamIdPath, "{}", await getEthersOverrides(POLYGON))
    log("Creating stream %s", streamId)
    const streamTr = await streamTx.wait()
    log("Events: %o", streamTr.events?.map((e) => e.event))
    log("Args: %o", streamTr.events?.map((e) => e.args))

    const client = new StreamrClient({
        restUrl: STREAMR_API_URL,
        auth: {
            privateKey: adminWallet.privateKey,
        }
    })
    const sessionToken = await client.session.getSessionToken()
    log("Core-api session token: %s", sessionToken)

    // create product into the core-api (simulate marketplace)
    const createRes = await fetch(`${STREAMR_API_URL}/products/`, {
        method: 'POST',
        headers: {
            "Accept": "application/json",
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
            type: "DATAUNION",
            state: "NOT_DEPLOYED",
            beneficiaryAddress,
            dataUnionVersion: 2
        }),
    })
    const createResJson = await createRes.json()
    log("Created product in core-api: %o", createResJson)
    const productId = createResJson.id
    const productIdBytes = "0x" + productId

    // add stream to product
    const streamIdURIEncoded = encodeURIComponent(streamId)
    let status = 0
    do {
        const addRes = await fetch(`${STREAMR_API_URL}/products/${productId}/streams/${streamIdURIEncoded}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sessionToken}`
            },
            body: "{}",
        })
        log("Add stream to product returned %s %s", addRes.status, addRes.statusText)
        status = addRes.status
    } while (status !== 204)

    // function createProduct(
    //    bytes32 id, string memory name, address beneficiary, uint pricePerSecond, address pricingToken, uint minimumSubscriptionSeconds
    // )
    await (await market.connect(adminWallet).createProduct(
        productIdBytes, productName, beneficiaryAddress, 2, pricingTokenAddress, 1,
        await getEthersOverrides())).wait()
    log(` - product created (id: ${productId}).`)
    return productIdBytes
}

const getProduct = async (productId: string): Promise<any[]> => {
    log('Get product by id: ', productId)
    const product = await market.getProduct(productId)
    const [name, owner, beneficiary, pricePerSecond, pricingTokenAddress, minimumSubscriptionSeconds, state, requiresWhitelist] = product
    log('   - product name: ', name)
    log('   - product owner: ', owner)
    log('   - product beneficiary: ', beneficiary)
    log('   - product pricePerSecond: ', pricePerSecond)
    log('   - product pricingTokenAddress: ', pricingTokenAddress)
    log('   - product minimumSubscriptionSeconds: ', minimumSubscriptionSeconds)
    log('   - product state: ', state)
    log('   - product requiresWhitelist: ', requiresWhitelist)
    return product
}

const buyProductWithDATA = async (productId: string): Promise<void> => {
    log('Buy product by id: ', productId)
    const subscriptionSeconds = 100
    const [, , , pricePerSecond, pricingTokenAddress] = await getProduct(productId)
    log(`   - buyer has (before) ${await dataTokenContract.balanceOf(buyerWallet.address)} product pricing tokens (${pricingTokenAddress})`)

    log(`Sending token(${dataTokenContract.address}).approve(${market.address}, ${subscriptionSeconds * pricePerSecond})`)
    await (await dataTokenContract.connect(buyerWallet).approve(
        market.address, subscriptionSeconds * pricePerSecond,
        await getEthersOverrides())).wait()
    log(`Sending market(${market.address}).buy(${productId}, ${subscriptionSeconds})`)
    await (await market.connect(buyerWallet).buy(
        productId, subscriptionSeconds,
        await getEthersOverrides())).wait()
    log(`   - buyer has (after) ${await dataTokenContract.balanceOf(buyerWallet.address)} product pricing tokens (${pricingTokenAddress})`)
    log('   - product bought with DataToken.')
}

const updateProduct = async (
    productId: string,
    productName: string,
    beneficiary: string,
    pricePerSecond: number,
    pricingToken: string,
    minimumSubscriptionSeconds: number,
    redeploy: boolean
): Promise<void> => {
    log(`Update product (id: ${productId})`)
    await (await market.connect(adminWallet).updateProduct(
        productId,
        productName,
        beneficiary,
        pricePerSecond,
        pricingToken,
        minimumSubscriptionSeconds,
        redeploy,
        await getEthersOverrides())).wait()
    log("   - product updated.")
}

const getSubscription = async (productId: string, subscriber = buyerWallet.address): Promise<void> => {
    log(`Get subscription for product id: ${productId} and subscriber: ${subscriber}`)
    const [isValid, endTimestamp] = await market.getSubscription(productId, subscriber)
    log('   - isValid: ', isValid)
    log('   - endTimestamp: ', endTimestamp)
}

const transferProductOwnership = async (productId: string): Promise<void> => {
    log(`Transfer product ownership (id: ${productId})`)
    const productOwnerBefore = (await market.getProduct(productId))[1]
    await (await market.connect(adminWallet).offerProductOwnership(productId, wallet.address)).wait()
    await (await market.connect(wallet).claimProductOwnership(productId)).wait()
    const productOwnerAfter = (await market.getProduct(productId))[1]
    log(`   - product ownership transferred from ${productOwnerBefore} to ${productOwnerAfter}.`)
}

// const buyWithEth = async (productId: string, minSubscriptionSeconds = 1, timeWindow = 8400 /* 1 day */): Promise<void> => {
//     log('Buy product with ETH.')
//     log(`   - marketplace address: ${await uniswap2Adapter.marketplace()}`)
//     log(`   - uniswap router address: ${await uniswap2Adapter.uniswapRouter()}`)
//     await (await uniswap2Adapter.buyWithETH(productId, minSubscriptionSeconds, timeWindow, {value: parseEther("1.0")})).wait()
//     log('   - product bought.')
// }

// const buyWithERC20 = async (productId: string, amount = parseEther("1"), minSubscriptionSeconds = 1, timeWindow = 8400) => {
//     log("Buy with ERC20 OtherToken:")
//     const balance = await otherTokenContract.balanceOf(deploymentOwner.address)
//     log(' - deploymentOwner has OtherToken balance:', balance)

//     const allowanceOtherTokenBefore = await otherTokenContract.allowance(deploymentOwner.address, uniswap2Adapter.address)
//     log(` - uniswap adapter has ${allowanceOtherTokenBefore} OtherToken allowance before approve.`)
//     await(await otherTokenContract.connect(deploymentOwner).approve(uniswap2Adapter.address, amount)).wait()
//     const allowanceOtherTokenAfter = await otherTokenContract.allowance(deploymentOwner.address, uniswap2Adapter.address)
//     log(` - uniswap adapter has ${allowanceOtherTokenAfter} OtherToken allowance after approve.`)

//     log(`Buy product for ${amount} OtherToken tokens.`)
//     await(await otherTokenContract.connect(deploymentOwner).approve(uniswap2Adapter.address, amount)).wait()
//     await (await uniswap2Adapter.connect(deploymentOwner)
//         .buyWithERC20(productId, minSubscriptionSeconds, timeWindow, otherTokenContract.address, amount)).wait()
//     log('   - product bought.')
// }

const testUniswapRouter = async (): Promise<void> => {
    log('Test uniswap router:')
    // DATA / OtherToken conversion rate is 1:10  (e.g. 1 DATA ~= 10 OtherToken)
    log(" - get pool conversion rate:")
    const tokenIn = 50
    const amountsOut = await uniswapRouter.getAmountsOut(tokenIn, [dataTokenContract.address, otherTokenContract.address])
    const tokenOut = amountsOut[1].toNumber() // ~= 10 dataToken
    log(` - uniswap conversion rate for DATA/OtherToken: ${tokenIn} tokensIn => ${tokenOut} tokensOut`)

    log(" - approve router to spend DATA tokens:")
    await(await dataTokenContract.approve(uniswapRouter.address, tokenIn)).wait()
    const allowanceData = await dataTokenContract.allowance(wallet.address, uniswapRouter.address)
    log(' - router DATA allowance:', allowanceData)

    log(' - DATA balance before swap: ', await dataTokenContract.balanceOf(wallet.address))
    log(' - OtherToken balance before swap: ', await otherTokenContract.balanceOf(wallet.address))

    const amounts = await uniswapRouter.swapExactTokensForTokens(
        tokenIn,
        0,
        [dataTokenContract.address, otherTokenContract.address],
        wallet.address,
        16725239990)
    await amounts.wait()

    log(' - DATA balance after swap', await dataTokenContract.balanceOf(wallet.address))
    log(' - OtherToken balance after swap', await otherTokenContract.balanceOf(wallet.address))
}

const onTransferAndCall = async (contractAddress: string, value: number | BigNumber, data: string): Promise<void> => {
    log("On token transfer to contract:", contractAddress)
    await (await dataTokenContract.transferAndCall(contractAddress, value, data)).wait()
}

async function main() {
    const deployToMainchain = true // toggle true/false to switch between mainchain and hardhat env

    if (deployToMainchain) {
        // npm run interact
        await connectToAllContracts()
        const productId = await createProduct()
        await getSubscription(productId)
        await getProduct(productId)
        await buyProductWithDATA(productId)
        await updateProduct(productId, "Product name updated!", wallet.address, 3, dataTokenContract.address, 1, false)
        // await transferProductOwnership(productId)
    } else {
        // npm run interactHH
        await connectToAllContractsToHardhat()
        const productId = await createProduct()
        await getSubscription(productId)
        await getProduct(productId)
        await buyProductWithDATA(productId)
        await updateProduct(productId, "Product name updated!", wallet.address, 3, dataTokenContract.address, 1, false)
        await onTransferAndCall(market.address, parseEther("30"), productId)
        await testUniswapRouter()
        await transferProductOwnership(productId)
    }

    // interact with Uniswap2Adapter
    // await buyWithERC20(productId) // fails
    // await buyWithEth(productId) // fails
    // await onTransferAndCall(uniswap2Adapter.address, parseEther("1"), productId)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
