import { waffle, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { utils, Wallet } from "ethers"
import  * as WETH9Json from '@uniswap/v2-periphery/build/WETH9.json'
import  * as UniswapV2FactoryJson from '@uniswap/v2-core/build/UniswapV2Factory.json'
import  * as UniswapV2Router02Json from '@uniswap/v2-periphery/build/UniswapV2Router02.json'
import type { DATAv2, ERC20Mintable, MarketplaceV4, MinimalForwarder, ProjectRegistry, StreamRegistryV3, Uniswap2Adapter } from "../../typechain"
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

const { provider: waffleProvider } = waffle
const { hexlify, id, parseEther, toUtf8Bytes, zeroPad } = utils
const { getContractFactory } = hardhatEthers

export const log = (..._: unknown[]): void => { /* skip logging */ }
// export const { log } = console

use(waffle.solidity)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const types = {
    EIP712Domain: [
        {
            name: 'name', type: 'string'
        },
        {
            name: 'version', type: 'string'
        },
        {
            name: 'chainId', type: 'uint256'
        },
        {
            name: 'verifyingContract', type: 'address'
        },
    ],
    ForwardRequest: [
        {
            name: 'from', type: 'address'
        },
        {
            name: 'to', type: 'address'
        },
        {
            name: 'value', type: 'uint256'
        },
        {
            name: 'gas', type: 'uint256'
        },
        {
            name: 'nonce', type: 'uint256'
        },
        {
            name: 'data', type: 'bytes'
        },
    ],
}

describe("Uniswap2AdapterV4", () => {
    const [
        admin,
        beneficiary,
        buyer,
        forwarder,
        forwarder2,
        other,
    ]: Wallet[] = waffleProvider.getWallets()

    let dataToken: DATAv2 // the token in which the product is paid to product beneficiary
    let erc677Token: DATAv2
    let fromToken: ERC20Mintable
    let market: MarketplaceV4
    let streamRegistry: StreamRegistryV3
    let projectRegistry: ProjectRegistry
    let minimalForwarder: MinimalForwarder
    let uniswap2Adapter: Uniswap2Adapter
    let uniswapFactory: any
    let uniswapRouter: any
    let wethFactory: any

    const day = 86400
    const productIdbytes = hexlify(zeroPad(toUtf8Bytes("test-adapter"), 32))
    const chainId = 137 // domain id for polygon mainnet
    const domainIds: number[] = [] // not the actual network ids => unique ids assigned by hyperlane
    const paymentDetailsDefault: any[] = [] // PaymentDetailsByChain[]

    before(async () => {
        await deployErc20ContractsAndMintTokens()
        domainIds.push(chainId)
        paymentDetailsDefault.push([
            beneficiary.address, // beneficiary
            dataToken.address, // pricingTokenAddress
            parseEther("1") // pricePerSecond
        ])
        await deployMinimalForwarder()
        await deployStreamRegistry()
        await deployProjectRegistry()
        await projectRegistry.createProject(productIdbytes, domainIds, paymentDetailsDefault, [], 0, true, 'metadata')
        await deployMarketplace()
        await deployUniswap2Contracts(admin)
        await deployUniswap2Adapter()
        await addLiquidityToUniswap()
    })

    async function deployErc20ContractsAndMintTokens() {
        // deploy DATAv2
        const dataTokenFactory = await getContractFactory("DATAv2", admin)
        dataToken = await dataTokenFactory.deploy() as DATAv2
        await dataToken.grantRole(id("MINTER_ROLE"), admin.address)
        
        erc677Token = await dataTokenFactory.deploy() as DATAv2
        await erc677Token.grantRole(id("MINTER_ROLE"), admin.address)

        // deploy ERC20 for testing
        const fromTokenFactory = await getContractFactory("ERC20Mintable", admin)
        fromToken = await fromTokenFactory.deploy() as ERC20Mintable

        // mint tokens for testing
        await dataToken.mint(admin.address, parseEther("100000000"))
        await dataToken.mint(buyer.address, parseEther("100000000"))
        await erc677Token.mint(admin.address, parseEther("100000000"))
        await erc677Token.mint(buyer.address, parseEther("100000000"))
        await fromToken.mint(admin.address, parseEther("100000000"))
        await fromToken.mint(buyer.address, parseEther("100000000"))
    }

    async function deployUniswap2Contracts(creator: Wallet): Promise<void> {
        const factory = await getContractFactory(WETH9Json.abi, WETH9Json.bytecode)
        wethFactory = await factory.deploy()
        log('WETH was deployed at address: ', wethFactory.address)

        const uniswapV2Factory = await getContractFactory(UniswapV2FactoryJson.abi, UniswapV2FactoryJson.bytecode)
        uniswapFactory = await uniswapV2Factory.deploy(creator.address)
        log('UniswapV2Factory was deployed at address: ', uniswapFactory.address)

        const uniswapRouterFactory = await getContractFactory(UniswapV2Router02Json.abi, UniswapV2Router02Json.bytecode)
        uniswapRouter = await uniswapRouterFactory.deploy(uniswapFactory.address, wethFactory.address)
        log('UniswapV2Router02 was deployed at address: ', uniswapRouter.address)
    }

    async function deployUniswap2Adapter(): Promise<void> {
        const uniswap2AdapterFactory = await getContractFactory("Uniswap2AdapterV4")
        uniswap2Adapter = await uniswap2AdapterFactory.deploy(
            market.address,
            projectRegistry.address,
            uniswapRouter.address,
            chainId
        ) as Uniswap2Adapter
        log('Uniswap2Adapter was deployed at address: ', uniswap2Adapter.address)
    }

    async function deployMinimalForwarder(): Promise<void> {
        log("Deploying MinimalForwarder: ")
        const factory = await getContractFactory('MinimalForwarder', forwarder)
        minimalForwarder = await factory.deploy() as MinimalForwarder
        log("   - MinimalForwarder deployed at: ", minimalForwarder.address)
    }

    async function deployStreamRegistry(): Promise<void> {
        const contractFactory = await getContractFactory("StreamRegistryV3", admin)
        const contractFactoryTx = await upgrades.deployProxy(
            contractFactory,
            [ZERO_ADDRESS, ZERO_ADDRESS], // ensCacheAddr & trustedForwarderAddress can be set to zero address while testing this adapter
            { kind: 'uups' })
        streamRegistry = await contractFactoryTx.deployed() as StreamRegistryV3
        log("StreamRegistry was deployed at address: ", streamRegistry.address)
    }

    async function deployProjectRegistry(): Promise<void> {
        const contractFactory = await getContractFactory("ProjectRegistry", admin)
        const contractFactoryTx = await upgrades.deployProxy(contractFactory, [streamRegistry.address], { kind: 'uups' })
        projectRegistry = await contractFactoryTx.deployed() as ProjectRegistry
        log("ProjectRegistry was deployed at address: ", projectRegistry.address)
    }

    async function deployMarketplace(): Promise<void> {
        const marketFactoryV4 = await getContractFactory("MarketplaceV4")
        const marketFactoryV4Tx = await upgrades.deployProxy(marketFactoryV4, [projectRegistry.address, chainId], { kind: 'uups' })
        market = await marketFactoryV4Tx.deployed() as MarketplaceV4
        // await market.addMailbox(interchainMailbox) // necessary for cross-chain purchases only
        // grant trusted role to marketpalce contract => needed for granting permissions to buyers
        await projectRegistry.grantRole(id("TRUSTED_ROLE"), market.address)
    }

    async function addLiquidityToUniswap() { // https://docs.uniswap.org/protocol/V2/reference/smart-contracts/router-02
        // 10 dataToken ~= 1 fromToken
        const dataAmount = parseEther("10000") // product token amount
        const fromAmount = parseEther("1000")
        const deadline = 2525000000 // epoch time for year 2050

        // Approve uniswap to spend DATA and ERC20 tokens
        await dataToken.approve(uniswapRouter.address, parseEther("100000"))
        await erc677Token.approve(uniswapRouter.address, parseEther("100000"))
        await fromToken.approve(uniswapRouter.address, parseEther("100000"))

        let tx = await uniswapRouter.addLiquidity(
            dataToken.address, // A pool token.
            fromToken.address, // A pool token.
            dataAmount, // The amount of dataToken to add as liquidity if the ERC20/DATA price is <= fromAmount/dataAmount (DATA depreciates).
            fromAmount, // The amount of fromToken to add as liquidity if the DATA/ERC20 price is <= dataAmount/fromAmount (ERC20 depreciates).
            0, // Bounds the extent to which the ERC20/DATA price can go up before the transaction reverts. Must be <= dataAmount.
            0, // Bounds the extent to which the DATA/ERC20 price can go up before the transaction reverts. Must be <= fromAmount.
            admin.address, // Recipient of the liquidity tokens.
            deadline // - Unix timestamp after which the transaction will revert.
        )
        await tx.wait()
        log('DATA/ERC20 liquidity pair added: ', await uniswapFactory.getPair(dataToken.address, fromToken.address))

        tx = await uniswapRouter.addLiquidity(
            dataToken.address,
            erc677Token.address,
            dataAmount,
            fromAmount,
            0,
            0,
            admin.address,
            deadline
        )
        await tx.wait()
        log('DATA2/ERC677 liquidity pair added: ', await uniswapFactory.getPair(erc677Token.address, fromToken.address))

        tx = await uniswapRouter.addLiquidityETH(
            dataToken.address, // A pool token.
            dataAmount, // The amount of token to add as liquidity if the WETH/DATA price is <= msg.value/dataAmount (token depreciates).
            0, // amountDATAMin - Bounds the extent to which the WETH/DATA price can go up before the transaction reverts. Must be <= amountData.
            0, // amountETHMin - Bounds the extent to which the DATA/WETH price can go up before the transaction reverts. Must be <= msg.value.
            admin.address, // Recipient of the liquidity tokens.
            deadline, // Unix timestamp after which the transaction will revert.
            {value: fromAmount}
        )
        await tx.wait()

        log('DATA/WETH liquidity pair added: ', await uniswapFactory.getPair(dataToken.address, await uniswapRouter.WETH()))
        log('Liquidity pairs count: ', await uniswapFactory.allPairsLength())
    }

    describe('Check Adaptor', () => {
        it('market is up and running', async () => {
            expect(await market.halted())
                .to.be.false
        })

        it('buyWithETH - negativetest - too many seconds fails', async () => {
            // 1 second = 1 DATA ~= 0.1 eth
            const value = parseEther("10")
            const secondsExpected = 99

            await expect(uniswap2Adapter.connect(buyer).buyWithETH(productIdbytes, secondsExpected + 1, day, { value }))
                .to.be.reverted

            await fromToken.connect(buyer).approve(uniswap2Adapter.address, value)
            await expect(uniswap2Adapter.connect(buyer).buyWithERC20(productIdbytes, secondsExpected + 1, day, fromToken.address, value))
                .to.be.reverted
        })

        it('buyWithETH - positivetest', async () => {
            log('Initialize subscription endTimestamp to block.timestamp')
            await market.connect(buyer).buy(productIdbytes, 0)

            const subBefore = await projectRegistry.getSubscription(productIdbytes, buyer.address)
            log('End timestamp before buy subscription: ', subBefore.endTimestamp)

            // 1 second = 1 DATA ~= 0.1 eth
            const value = parseEther("0.1")
            const secondsExpected = 1 // TODO: retreive expected from the liquidity pool

            await uniswap2Adapter.connect(buyer).buyWithETH(productIdbytes, 0, day, {value})

            const subAfter = await projectRegistry.getSubscription(productIdbytes, buyer.address)
            log('End timestamp after buy subscribtion: ', subAfter.endTimestamp)

            const secondsActual = subAfter.endTimestamp.sub(subBefore.endTimestamp).toNumber()
            log('afterTimestamp - beforeTimestamp: ', secondsActual)

            expect(subAfter.isValid).to.be.true
            expect(secondsActual).gte(secondsExpected)
        })

        it('buyWithERC20 - positivetest', async () => {
            log('Initialize subscription endTimestamp to block.timestamp')
            await market.connect(buyer).buy(productIdbytes, 0)

            const subBefore = await projectRegistry.getSubscription(productIdbytes, buyer.address)
            log('End timestamp before buy subscribtion: ', subBefore.endTimestamp)

            // 1 second ~= 0.1 ERC20
            const value = parseEther("0.1")
            const secondsExpected = 1 // TODO: retreive expected from the liquidity pool
            await fromToken.connect(buyer).approve(uniswap2Adapter.address, value)

            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.false
            await uniswap2Adapter.connect(buyer).buyWithERC20(productIdbytes, 0, day, fromToken.address, value)
            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.true

            const subAfter = await projectRegistry.getSubscription(productIdbytes, buyer.address)
            log('End timestamp after buy subscribtion: ', subAfter.endTimestamp)

            const secondsActual = subAfter.endTimestamp.sub(subBefore.endTimestamp).toNumber()
            log('afterTimestamp - beforeTimestamp: ', secondsActual)

            expect(subAfter.isValid).to.be.true
            expect(secondsActual).gte(secondsExpected)
        })

        it('transferAndCall - positivetest - can buy products in one transaction using ERC677 tokens', async () => {
            // initialize subscription endTimestamp to block.timestamp + 1
            await projectRegistry.grantSubscription(productIdbytes, 1, admin.address)
            const subscription = await projectRegistry.getOwnSubscription(productIdbytes)

            // erc677Token / dataToken conversion rate is 1:10  (e.g. 1 erc677Token ~= 10 dataToken)
            const erc677TokenIn = 1
            const amountsOut = await uniswapRouter.getAmountsOut(erc677TokenIn, [erc677Token.address, dataToken.address])
            const pricingTokenOut = amountsOut[1].toNumber() // ~= 10 dataToken
            const pricePerSecond = 1 // must be the pricePerSecond value added when the product was created
            const expectedEndTimestamp = subscription.endTimestamp.add(pricingTokenOut / pricePerSecond)

            await expect(erc677Token.transferAndCall(uniswap2Adapter.address, parseEther(String(erc677TokenIn)), productIdbytes))
                .to.emit(projectRegistry, 'Subscribed')
                .withArgs(productIdbytes, admin.address, expectedEndTimestamp)
        })
    })
    
    describe('Metatransactions', (): void => {
        async function prepareBuyWithERC20Metatx(minimalForwarder: MinimalForwarder, signKey: string, gas = '1000000') {
            // 1 second ~= 0.1 ERC20
            const value = parseEther("0.1")

            // buyer is creating and signing transaction, forwarder is posting it and paying for gas
            const data = uniswap2Adapter.interface.encodeFunctionData('buyWithERC20', [productIdbytes, 0, day, fromToken.address, value])
            const req = {
                from: buyer.address,
                to: uniswap2Adapter.address,
                value: '0',
                gas,
                nonce: (await minimalForwarder.getNonce(buyer.address)).toString(),
                data
            }
            const d: TypedMessage<any> = {
                types,
                domain: {
                    name: 'MinimalForwarder',
                    version: '0.0.1',
                    chainId: (await waffleProvider.getNetwork()).chainId,
                    verifyingContract: minimalForwarder.address,
                },
                primaryType: 'ForwardRequest',
                message: req,
            }
            const options = {
                data: d,
                privateKey: utils.arrayify(signKey) as Buffer,
                version: SignTypedDataVersion.V4,
            }
            const sign = signTypedData(options) // forwarder
            return {req, sign, value}
        }

        let trustedForwarderRole: string
        before(async () => {
            trustedForwarderRole = await projectRegistry.TRUSTED_FORWARDER_ROLE()
            await projectRegistry.grantRole(trustedForwarderRole, minimalForwarder.address)
        })
        
        it('isTrustedForwarder - positivetest', async (): Promise<void> => {
            expect(await projectRegistry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
        })

        it('buyWithERC20 - positivetest', async (): Promise<void> => {
            const {req, sign, value} = await prepareBuyWithERC20Metatx(minimalForwarder.connect(forwarder), buyer.privateKey)
            await fromToken.connect(buyer).approve(uniswap2Adapter.address, value)
            expect(await minimalForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.false
            await minimalForwarder.connect(forwarder)
                .execute(req, sign)
            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.true
        })

        it('buyWithERC20 - negativetest - wrong forwarder', async (): Promise<void> => {
            // deploy second minimal forwarder
            const factory = await getContractFactory('MinimalForwarder', forwarder)
            const wrongForwarder = await factory.deploy() as MinimalForwarder
            expect(await projectRegistry.isTrustedForwarder(wrongForwarder.address))
                .to.be.false

            // check that metatx works with new forwarder
            const {req, sign} = await prepareBuyWithERC20Metatx(wrongForwarder.connect(forwarder), buyer.privateKey)
            expect(await wrongForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            // check that the project doesn't have a valid subscription
            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.false
            
            await wrongForwarder.connect(forwarder).execute(req, sign)

            // internal call will have failed => subscription not extended
            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.false
        })

        it('buyWithERC20 - negativetest - wrong signature', async (): Promise<void> => {
            const wrongKey = other.privateKey // buyer.privateKey would be correct
            const {req, sign} = await prepareBuyWithERC20Metatx(minimalForwarder, wrongKey)
            expect(await minimalForwarder.verify(req, sign))
                .to.be.false
            await expect(minimalForwarder.execute(req, sign))
                .to.be.revertedWith('MinimalForwarder: signature does not match request')
        })

        it('buyWithERC20 - negativetest - not enough gas in internal transaction call', async (): Promise<void> => {
            const {req, sign} = await prepareBuyWithERC20Metatx(minimalForwarder, buyer.privateKey, '1000')
            expect(await minimalForwarder.verify(req, sign))
                .to.be.true

            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.false
            await minimalForwarder.execute(req, sign)
            // internal call will have failed => subscription not extended
            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.false
        })

        it('buyWithERC20 - positivetest - reset trusted forwarder', async (): Promise<void> => {
            // remove existing forwarder
            expect(await projectRegistry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
            await projectRegistry.revokeRole(trustedForwarderRole, minimalForwarder.address)
            expect(await projectRegistry.isTrustedForwarder(minimalForwarder.address))
                .to.be.false
            
            // deploy second minimal forwarder
            const factory = await getContractFactory('MinimalForwarder', forwarder2)
            const newForwarder = await factory.deploy() as MinimalForwarder

            // set the new forwarder
            expect(await projectRegistry.isTrustedForwarder(newForwarder.address))
                .to.be.false
            await projectRegistry.grantRole(trustedForwarderRole, newForwarder.address)
            expect(await projectRegistry.isTrustedForwarder(newForwarder.address))
                .to.be.true
                
            // check that metatx works with new forwarder
            const {req, sign, value} = await prepareBuyWithERC20Metatx(newForwarder, buyer.privateKey)
            expect(await newForwarder.verify(req, sign))
                .to.be.true

            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.false
            await fromToken.connect(buyer).approve(uniswap2Adapter.address, value)
            await newForwarder.execute(req, sign)
            expect(await projectRegistry.hasValidSubscription(productIdbytes, buyer.address))
                .to.be.true
        })
    })
})
