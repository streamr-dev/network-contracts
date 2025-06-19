/* eslint-disable quotes, no-console */
import { config, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { BigNumber, utils, constants, Wallet } from "ethers"
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

import type {
    DATAv2,
    ERC20Mintable,
    MarketplaceV4,
    MinimalForwarder,
    ProjectRegistryV1,
    StreamRegistryV5,
} from "../../../typechain"
import { types } from "./constants"

const { parseEther, hexlify, zeroPad, toUtf8Bytes, id } = utils
const { getContractFactory } = hardhatEthers

export const log = (..._: unknown[]): void => { /* skip logging */ }
// export const { log } = console

describe("MarketplaceV4", () => {
    let admin: Wallet
    let buyer: Wallet
    let other: Wallet
    let beneficiary: Wallet
    let forwarder: Wallet
    let signer: Wallet
    let signerPrivateKey: string
    let wrongSigner: Wallet
    let wrongSignerPrivateKey: string

    let token: DATAv2
    let otherToken: ERC20Mintable
    let marketplace: MarketplaceV4
    let minimalForwarder: MinimalForwarder
    let projectRegistry: ProjectRegistryV1
    let streamRegistry: StreamRegistryV5
    const streamIds: string[] = []

    const chainId = 137 // chain id for polygon mainnet
    const chainIds: number[] = [] // unique id assigned by hyperlane; same as chain id in EIP-155
    const paymentDetailsDefault: any[] = [] // PaymentDetailsByChain[]
    const paymentDetailsFreeProject: any[] = [] // PaymentDetailsByChain[]

    before(async () => {
        [admin, buyer, other, beneficiary, forwarder, signer, wrongSigner] = await hardhatEthers.getSigners() as unknown as Wallet[]
        const accounts = config.networks.hardhat.accounts as any
        signerPrivateKey = accounts[5].privateKey
        wrongSignerPrivateKey = accounts[6].privateKey
        log("WrongSigner: ", wrongSigner.address)

        await deployERC20()
        await deployOtherERC20()
        await deployMinimalForwarder()
        await deployStreamRegistry()
        await deployProjectRegistry()

        await streamRegistry.grantRole(id("TRUSTED_ROLE"), projectRegistry.address)
        marketplace = await deployMarketplace()

        chainIds.push(chainId)
        paymentDetailsDefault.push([
            beneficiary.address, // beneficiary
            token.address, // pricingTokenAddress
            BigNumber.from(2) // pricePerSecond
        ])
        paymentDetailsFreeProject.push([
            beneficiary.address, // beneficiary
            token.address, // pricingTokenAddress
            BigNumber.from(0) // pricePerSecond
        ])
    })

    async function deployERC20(): Promise<void> {
        log("Deploying DATAv2: ")
        const tokenFactory = await getContractFactory("DATAv2", admin)
        token = await tokenFactory.deploy() as DATAv2
        log("   - DATAv2 deployed at: ", token.address)
        await token.grantRole(id("MINTER_ROLE"), admin.address)
        await token.mint(admin.address, parseEther("1000"))
        await token.mint(other.address, parseEther("1000"))
    }

    async function deployOtherERC20(): Promise<void> {
        log("Deploying another ERC20 for testing: ")
        const otherTokenFactory = await getContractFactory("ERC20Mintable", admin)
        otherToken = await otherTokenFactory.deploy("Mintable Test Token", "TTT") as ERC20Mintable

        // mint tokens for testing
        await otherToken.mint(admin.address, parseEther("1000"))
        await otherToken.mint(other.address, parseEther("1000"))
    }

    async function deployMinimalForwarder(): Promise<void> {
        log("Deploying MinimalForwarder: ")
        const factory = await getContractFactory('MinimalForwarder', forwarder)
        minimalForwarder = await factory.deploy() as MinimalForwarder
        log("   - MinimalForwarder deployed at: ", minimalForwarder.address)
    }

    async function deployStreamRegistry(): Promise<void> {
        log("Deploying StreamRegistry: ")
        const contractFactory = await getContractFactory("StreamRegistryV5", admin)
        const contractFactoryTx = await upgrades.deployProxy(
            contractFactory,
            ["0x0000000000000000000000000000000000000000", minimalForwarder.address],
            { kind: 'uups' })
        streamRegistry = await contractFactoryTx.deployed() as StreamRegistryV5
        log("   - StreamRegistry deployed at: ", streamRegistry.address)

    }

    async function deployProjectRegistry(): Promise<void> {
        log("Deploying ProjectRegistryV1: ")
        const contractFactory = await getContractFactory("ProjectRegistryV1", admin)
        const contractFactoryTx = await upgrades.deployProxy(contractFactory, [streamRegistry.address], { kind: 'uups' })
        projectRegistry = await contractFactoryTx.deployed() as ProjectRegistryV1
        log("   - ProjectRegistryV1 deployed at: ", projectRegistry.address)
    }

    async function deployMarketplace(): Promise<MarketplaceV4> {
        log("Deploying MarketplaceV4: ")
        const marketFactoryV4 = await getContractFactory("MarketplaceV4", admin)
        const marketFactoryV4Tx = await upgrades.deployProxy(marketFactoryV4, [projectRegistry.address, chainId], { kind: 'uups' })
        const market = await marketFactoryV4Tx.deployed() as MarketplaceV4
        log("   - MarketplaceV4 deployed at: ", market.address)
        // grant trusted role to marketpalce contract => needed for granting permissions to buyers
        await projectRegistry.grantRole(id("TRUSTED_ROLE"), market.address)
        return market
    }

    let runningId = 0

    async function createProject({
        chains = chainIds,
        payment = paymentDetailsDefault,
        streams = streamIds,
        minimumSubscriptionSeconds = 1,
        isPublicPurchable = true,
        metadata = "",
        creator = admin,
    } = {}): Promise<string> {
        const name = 'MarketplaceV4-test-project-' + (runningId++)
        const projectId = hexlify(zeroPad(toUtf8Bytes(name), 32))
        await projectRegistry.connect(creator)
            .createProject(projectId, chains, payment, streams, minimumSubscriptionSeconds, isPublicPurchable, metadata)
        log("   - created project: ", projectId)
        return projectId
    }

    describe("UUPS upgradeability", () => {
        it("works before and after upgrading", async () => {
            const marketFactoryV4 = await getContractFactory("MarketplaceV4", admin)
            const marketFactoryV4Tx = await upgrades.deployProxy(marketFactoryV4, [
                projectRegistry.address,
                chainId,
            ], { kind: 'uups' })
            const marketplaceV4 = await marketFactoryV4Tx.deployed() as MarketplaceV4

            const marketFactoryV4_1 = await getContractFactory("MarketplaceV4") // this would be the upgraded version (e.g. MarketplaceV4_1)
            const marketFactoryV4_1Tx = await upgrades.upgradeProxy(marketFactoryV4Tx.address, marketFactoryV4_1)
            const marketplaceV4_1 = await marketFactoryV4_1Tx.deployed() as MarketplaceV4

            expect(marketplaceV4.address)
                .to.equal(marketplaceV4_1.address)
        })
    })

    describe('Buying products', () => {
        it('setTxFee - positivetest', async () => {
            // set market fee to 25%
            const fee = parseEther('0.25')
            await expect(marketplace.setTxFee(fee))
                .to.emit(marketplace, 'TxFeeChanged')
                .withArgs(fee)
            // set market fee to 100%
            const fee2 = parseEther('1.0')
            await expect(marketplace.setTxFee(fee2))
                .to.emit(marketplace, 'TxFeeChanged')
                .withArgs(fee2)
            // reset market fee to 0
            await expect(marketplace.setTxFee(0))
                .to.emit(marketplace, 'TxFeeChanged')
                .withArgs(0)
        })

        it('setTxFee - negativetest - must be less than 1 (1 ether means 100%)', async () => {
            await expect(marketplace.setTxFee(parseEther('1.1')))
                .to.be.revertedWith('error_invalidTxFee')
        })

        it('setTxFee - negativetest - fails if not called by the owner', async () => {
            await expect(marketplace.connect(other).setTxFee(parseEther('0.25')))
                .to.be.revertedWith('Ownable: caller is not the owner')
        })

        it('txFee token distribution works', async () => {
            const projectId = await createProject()
            const fee = parseEther('0.25')
            await expect(marketplace.setTxFee(fee))
                .to.emit(marketplace, 'TxFeeChanged')
                .withArgs(fee)

            // enough approved with added fee
            await token.connect(other).approve(marketplace.address, 1000) // pricePerSecond = 2
            const ownerBefore = await token.balanceOf(admin.address)
            const sellerBefore = await token.balanceOf(beneficiary.address)

            await marketplace.connect(other).buy(projectId, 500) // pricePerSecond = 2

            // fee is correct
            const ownerAfter = await token.balanceOf(admin.address)
            const sellerAfter = await token.balanceOf(beneficiary.address)
            // owner receives fee
            expect(ownerAfter.sub(ownerBefore)).to.equal(250)
            // seller receives price - fee
            expect(sellerAfter.sub(sellerBefore)).to.equal(750)

            // reset marketplace fee to 0
            await expect(marketplace.setTxFee(0))
                .to.emit(marketplace, 'TxFeeChanged')
                .withArgs(0)
        })

        it('fails for bad arguments', async () => {
            const projectId = await createProject()

            await expect(marketplace.buy(projectId, 0))
                .to.be.revertedWith('error_newSubscriptionTooSmall')

            await expect(marketplace.connect(other).buy(projectId, 0))
                .to.be.revertedWith('error_newSubscriptionTooSmall')
        })

        it('fails if allowance not given', async () => {
            const projectId = await createProject()
            await expect(marketplace.buy(projectId, 100))
                .to.be.revertedWith('ERC20: transfer amount exceeds allowance')
        })

        it('fails if too little allowance was given', async () => {
            const projectId = await createProject()
            await token.approve(marketplace.address, 99)
            await expect(marketplace.buy(projectId, 100))
                .to.be.revertedWith('ERC20: transfer amount exceeds allowance')
        })

        it('works if enough allowance was given', async () => {
            const projectId = await createProject()
            await token.approve(marketplace.address, 1000)
            await expect(marketplace.buy(projectId, 100))
                .to.emit(projectRegistry, 'NewSubscription')
                // TODO: test for endTtimestamps
            expect(await projectRegistry.hasValidSubscription(projectId, admin.address))
                .to.be.true
        })

        it('can pay to non-contract addresses', async () => {
            const projectId = await createProject()
            const sellerAddress = '0x1234567890123456789012345678901234567890'
            const balanceBefore = await token.balanceOf(sellerAddress)

            await token.approve(marketplace.address, 1000)
            const paymentDetails: any = [
                [
                    sellerAddress, // beneficiary
                    token.address, // pricingTokenAddress
                    BigNumber.from(1) // pricePerSecond
                ]
            ]
            await projectRegistry.updateProject(projectId, chainIds, paymentDetails, [], 1, 'metadata')
            await marketplace.buy(projectId, 100)
            const balanceAfter = await token.balanceOf(sellerAddress)

            expect(balanceBefore).to.equal(0)
            expect(balanceAfter).to.equal(100)
        })

        it('can buy products in one transaction (transferAndCall)', async () => {
            const projectId = await createProject()

            await projectRegistry.grantSubscription(projectId, 1, admin.address)
            const subscription = await projectRegistry.getOwnSubscription(projectId)

            const pricingTokenIn = 100
            const pricePerSecond = paymentDetailsDefault[0][2]
            const expectedEndTimestamp = subscription.endTimestamp.add(pricingTokenIn / pricePerSecond)

            await expect(token.transferAndCall(marketplace.address, parseEther(String(pricingTokenIn)), projectId))
                .to.emit(projectRegistry, 'Subscribed')
                .withArgs(projectId, admin.address, expectedEndTimestamp)
        })

        it('transferAndCall | onTokenTransfer - negativetest - fails is the pricing token is not an ERC677', async () => {
            const paymentDetails = [
                [
                    beneficiary.address,
                    otherToken.address, // pricingTokenAddress is not ERC677
                    BigNumber.from(2)
                ]
            ]
            const projectId = await createProject({ payment: paymentDetails })

            await expect(token.transferAndCall(marketplace.address, parseEther('10'), projectId))
                .to.be.revertedWith('error_wrongPricingToken')
        })

        it('transferAndCall | onTokenTransfer - negativetest - fails if the pricing token is not an ERC677', async () => {
            const paymentDetails = [
                [
                    beneficiary.address,
                    otherToken.address, // pricingTokenAddress is not ERC677
                    BigNumber.from(2)
                ]
            ]
            const projectId = await createProject({ payment: paymentDetails })

            await expect(token.transferAndCall(marketplace.address, parseEther('10'), projectId))
                .to.be.revertedWith('error_wrongPricingToken')
        })

        it(`transferAndCall | onTokenTransfer - negativetest - fails bad project id`, async () => {
            await expect(token.transferAndCall(marketplace.address, parseEther('10'), '0x1234')) // not bytes32
                .to.be.revertedWith("error_badProjectId")
        })

        it('buy - positivetest - beneficiary can react on project purchase', async () => {
            const marketFactoryV4 = await getContractFactory("MarketplaceV4", admin)
            const marketFactoryV4Tx = await upgrades.deployProxy(marketFactoryV4, [
                projectRegistry.address,
                chainId,
            ], { kind: 'uups' })
            const market = await marketFactoryV4Tx.deployed() as MarketplaceV4
            // grant trusted role to marketpalce contract => needed for granting permissions to buyers
            await projectRegistry.grantRole(id("TRUSTED_ROLE"), market.address)

            // deploy mock beneficiary contract from which the beneficiary can react to a product purchase
            const mockBeneficiaryFactory = await getContractFactory("MockMarketplaceBeneficiary")
            const mockBeneficiary = await mockBeneficiaryFactory.deploy()

            // // const name = 'project-' + Math.round(Math.random() * 1000000)
            const projectId = hexlify(zeroPad(toUtf8Bytes('project-react'), 32))
            const beneficiaryAddress = mockBeneficiary.address
            const pricePerSecond = 2
            const subscriptionSeconds = 500
            const paymentDetails1: any[] = [
                [
                    beneficiaryAddress, // beneficiary
                    token.address, // pricingTokenAddress
                    pricePerSecond, // pricePerSecond
                ]
            ]
            const paymentDetails2: any[] = [
                [
                    beneficiaryAddress, // beneficiary
                    otherToken.address, // pricingTokenAddress
                    pricePerSecond, // pricePerSecond
                ]
            ]

            // create project with ERC677 pricingToken
            await projectRegistry
                .createProject(projectId, chainIds, paymentDetails1, [], 1, true, 'metadata')
            expect(await token.balanceOf(beneficiaryAddress))
                .to.equal(0)
            await token.approve(market.address, 1000)
            await expect(market.buy(projectId, subscriptionSeconds))
                .to.emit(mockBeneficiary, "OnTokenTransferCalled") // will notify beneficiary
            expect(await token.balanceOf(beneficiaryAddress))
                .to.equal(subscriptionSeconds * pricePerSecond)

            // change pricing token to ERC20
            await projectRegistry
                .updateProject(projectId, chainIds, paymentDetails2, [], 1, 'metadata')
            await otherToken.approve(market.address, 1000)
            expect(await otherToken.balanceOf(beneficiaryAddress))
                .to.equal(0)
            await expect(market.buy(projectId, subscriptionSeconds))
                .to.not.emit(mockBeneficiary, "OnTokenTransferCalled") // will NOT notify beneficiary
            expect(await otherToken.balanceOf(beneficiaryAddress))
                .to.equal(subscriptionSeconds * pricePerSecond)
        })

        it('buy - positivetest - marketplace owner can buy project on halted market', async () => {
            const projectId = await createProject()
            await token.connect(admin).approve(marketplace.address, 200) // admin is also the marketplace owner

            await marketplace.halt()
            await expect(marketplace.connect(admin).buy(projectId, 100))
                .to.emit(projectRegistry, 'Subscribed')
            await marketplace.resume()
        })

        it('buy - negativetest - reverts if marketplace is halted', async () => {
            const projectId = await createProject()

            await marketplace.halt()
            await expect(marketplace.connect(other).buy(projectId, 100))
                .to.be.revertedWith("error_halted")
            await marketplace.resume()
        })

        it('buy - negativetest - unable to purchase free projects (pricePerSecond=0)', async () => {
            const freeProjectId = await createProject({ payment: paymentDetailsFreeProject })

            await expect(marketplace.buy(freeProjectId, 100))
                .to.be.revertedWith("error_freeProjectsNotSupportedOnMarketplace")
        })

        it('buy - negativetest - unable to purchase private projects', async () => {
            const projectId = await createProject({ isPublicPurchable: false })

            await expect(marketplace.connect(other).buy(projectId, 100))
                .to.be.revertedWith("error_unableToBuyProject")
        })

        it('buyFor - negativetest - reverts if marketplace is halted', async () => {
            const projectId = await createProject()

            await marketplace.halt()
            await expect(marketplace.connect(other).buyFor(projectId, 100, admin.address))
                .to.be.revertedWith("error_halted")
            await marketplace.resume()
        })
    })

    describe('Admin powers', () => {
        it("can't be invoked by non-admins", async () => {
            const market = await deployMarketplace()
            await expect(market.connect(other).halt())
                .to.be.revertedWith("Ownable: caller is not the owner")
            await expect(market.connect(other).resume())
                .to.be.revertedWith("Ownable: caller is not the owner")
        })

        it('halt, resume - positivetest - can halt buying except for the owner', async () => {
            const projectId = await createProject()
            await token.approve(marketplace.address, 1000)
            await token.connect(other).approve(marketplace.address, 1000)

            // anyone can buy products
            await expect(marketplace.connect(other).buy(projectId, 100))
                .to.emit(projectRegistry, "Subscribed")

            await expect(marketplace.halt())
                .to.emit(marketplace, "Halted")

            // marketplace is halted => admin can buy products
            await expect(marketplace.buy(projectId, 100))
                .to.emit(projectRegistry, "Subscribed")
            // marketplace is halted => other users can't buy products
            await expect(marketplace.connect(other).buy(projectId, 100))
                .to.be.revertedWith("error_halted")

            await expect(marketplace.resume())
                .to.emit(marketplace, "Resumed")

            // marketplace is resumed => anyone can buy products
            await expect(marketplace.connect(other).buy(projectId, 100))
                .to.emit(projectRegistry, "Subscribed")
        })

        it('transferOwnership - positivetest', async () => {
            const market = await deployMarketplace()
            const admin2 = other

            await expect(market.connect(admin2).halt())
                .to.be.revertedWith("Ownable: caller is not the owner")

            // admin can transferOwnership to admin2
            await market.connect(admin).transferOwnership(admin2.address)
            await market.connect(admin2).claimOwnership()
            // admin2 can halt market
            await expect(market.connect(admin2).halt())
                .to.emit(market, "Halted")

            // admin2 can now transferOwnership to admin3
            const admin3 = beneficiary
            await market.connect(admin2).transferOwnership(admin3.address)
            await market.connect(admin3).claimOwnership()
            // admin2 has transferred ownership and is NOT able to resume the market
            await expect(market.connect(admin2).resume())
                .to.be.revertedWith("Ownable: caller is not the owner")
            // admin3 can now resume market
            await expect(market.connect(admin3).resume())
                .to.emit(market, "Resumed")
        })

        it('transferOwnership - negativetest - can not be transferred to zero address', async () => {
            await expect(marketplace.transferOwnership(constants.AddressZero))
                .to.be.revertedWith("Ownable: new owner is the zero address")
        })

        it('transferOwnership - negativetest - fails if not called by the owner', async () => {
            await expect(marketplace.connect(other).transferOwnership(admin.address))
                .to.be.revertedWith("Ownable: caller is not the owner")
        })

        it('claimOwnership - negativetest - fails if not called by the pending owner', async () => {
            await expect(marketplace.connect(other).claimOwnership())
                .to.be.revertedWith("onlyPendingOwner")
        })

        it('renounceOwnership - negativetest - fails if not called by the owner', async () => {
            await expect(marketplace.connect(other).renounceOwnership())
                .to.be.revertedWith("Ownable: caller is not the owner")
        })

        it('addMailbox - positivetest', async () => {
            const randomAddress = hardhatEthers.Wallet.createRandom().address
            await marketplace.connect(admin).addMailbox(randomAddress)
            expect(await marketplace.mailbox())
                .to.equal(randomAddress)
        })

        it('addMailbox - negativetest', async () => {
            const randomAddress = hardhatEthers.Wallet.createRandom().address
            await expect(marketplace.connect(other).addMailbox(randomAddress))
                .to.be.revertedWith("Ownable: caller is not the owner")
        })

        it('addRemoteMarketplace - positivetest', async () => {
            const randomAddress = hardhatEthers.Wallet.createRandom().address
            const remoteCahinId = 1
            await marketplace.connect(admin).addRemoteMarketplace(remoteCahinId, randomAddress)
            expect(await marketplace.remoteMarketplaces(remoteCahinId))
                .to.equal(randomAddress)
        })

        it('addRemoteMarketplace - negativetest', async () => {
            const randomAddress = hardhatEthers.Wallet.createRandom().address
            const remoteCahinId = 1
            await expect(marketplace.connect(other).addRemoteMarketplace(remoteCahinId, randomAddress))
                .to.be.revertedWith("Ownable: caller is not the owner")
        })
    })

    describe('Metatransactions', (): void => {
        before(async () => {
            const trustedForwarderRole = await projectRegistry.TRUSTED_FORWARDER_ROLE()
            await projectRegistry.grantRole(trustedForwarderRole, minimalForwarder.address)
            // each unit test must have at least subscriptionSeconds * pricePerSecond for mint/approve
            await(await token.mint(signer.address, 10000)).wait()
            await(await token.connect(signer).approve(marketplace.address, 10000)).wait()
        })

        async function prepareBuyMetatx(minimalForwarder: MinimalForwarder, signerObj: Wallet, signKey: string, gas = '1000000') {
            const projectId = await createProject()
            const subscriptionSeconds = 100

            // signerObj is creating and signing transaction, forwarder is posting it and paying for gas
            const data = marketplace.interface.encodeFunctionData('buy', [projectId, subscriptionSeconds])
            const req = {
                from: signerObj.address,
                to: marketplace.address,
                value: '0',
                gas,
                nonce: (await minimalForwarder.getNonce(signerObj.address)).toString(),
                data
            }
            const d: TypedMessage<any> = {
                types,
                domain: {
                    name: 'MinimalForwarder',
                    version: '0.0.1',
                    chainId: (await hardhatEthers.provider.getNetwork()).chainId,
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
            return {req, sign, projectId, subscriptionSeconds}
        }

        it('isTrustedForwarder - positivetest', async (): Promise<void> => {
            expect(await marketplace.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
        })

        it('buy - positivetest', async (): Promise<void> => {
            const {req, sign, projectId} = await prepareBuyMetatx(minimalForwarder.connect(forwarder), signer, signerPrivateKey)
            expect(await minimalForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.false

            await minimalForwarder.connect(forwarder).execute(req, sign)

            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.true
        })

        it('buy - negativetest - wrong forwarder', async (): Promise<void> => {
            // deploy second minimal forwarder
            const factory = await getContractFactory('MinimalForwarder', forwarder)
            const wrongForwarder = await factory.deploy() as MinimalForwarder

            // check that forwarder is set
            expect(await projectRegistry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
            expect(await projectRegistry.isTrustedForwarder(wrongForwarder.address))
                .to.be.false

            // check that metatx works with new forwarder
            const {req, sign, projectId} = await prepareBuyMetatx(wrongForwarder.connect(forwarder), signer, signerPrivateKey)
            expect(await wrongForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            // check that the project doesn't have a valid subscription
            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.false

            await wrongForwarder.connect(forwarder).execute(req, sign)

            // internal call will have failed => subscription was not extended
            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.false
        })

        it('buy - negativetest - wrong signature', async (): Promise<void> => {
            const {req, sign} = await prepareBuyMetatx(minimalForwarder, signer, wrongSignerPrivateKey)
            expect(await minimalForwarder.verify(req, sign))
                .to.be.false
            await expect(minimalForwarder.execute(req, sign))
                .to.be.revertedWith('MinimalForwarder: signature does not match request')
        })

        it('buy - negativetest - not enough gas in internal transaction call', async (): Promise<void> => {
            const {req, sign, projectId} = await prepareBuyMetatx(minimalForwarder, signer, signerPrivateKey, '1000')
            expect(await minimalForwarder.verify(req, sign))
                .to.be.true

            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.false
            await minimalForwarder.execute(req, sign)
            // internal call will have failed
            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.false
        })

        it('buy - positivetest - reset trusted forwarder', async (): Promise<void> => {
            const trustedForwarderRole = await projectRegistry.TRUSTED_FORWARDER_ROLE()

            // remove previous forwarder
            expect(await projectRegistry.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
            await projectRegistry.revokeRole(trustedForwarderRole, minimalForwarder.address)
            expect(await projectRegistry.isTrustedForwarder(minimalForwarder.address))
                .to.be.false

            // check that metatx does NOT works with old forwarder
            const { req: reqOld, sign: signOld, projectId: projectIdOld }: any =
                await prepareBuyMetatx(minimalForwarder, signer, signerPrivateKey)
            expect(await projectRegistry.hasValidSubscription(projectIdOld, buyer.address))
                .to.be.false
            expect(await minimalForwarder.verify(reqOld, signOld))
                .to.be.true // forwarder can verify
            await minimalForwarder.execute(reqOld, signOld) // but internal call will have failed for old forwarder
            expect(await projectRegistry.hasValidSubscription(projectIdOld, buyer.address))
                .to.be.false

            // deploy second minimal forwarder
            const factory = await getContractFactory('MinimalForwarder', forwarder)
            const newForwarder = await factory.deploy() as MinimalForwarder
            // set the new forwarder
            expect(await projectRegistry.isTrustedForwarder(newForwarder.address))
                .to.be.false
            await projectRegistry.grantRole(trustedForwarderRole, newForwarder.address)
            expect(await projectRegistry.isTrustedForwarder(newForwarder.address))
                .to.be.true

            // check that metatx works with new forwarder
            const {req, sign, projectId} = await prepareB   uyMetatx(newForwarder, signer, signerPrivateKey)
            expect(await newForwarder.verify(req, sign))
                .to.be.true
            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.false
            await newForwarder.execute(req, sign)
            expect(await projectRegistry.hasValidSubscription(projectId, signer.address))
                .to.be.true
        })

        it('getPurchaseInfo - positivetest', async (): Promise<void> => {
            const beneficiaryAddress: string = beneficiary.address
            const pricingTokenAddress = token.address
            const pricePerSecond = BigNumber.from(2)
            const payment: any[] = [
                [
                    beneficiaryAddress,
                    pricingTokenAddress,
                    pricePerSecond
                ]
            ]
            const subscriptionSeconds = 100
            const price = pricePerSecond.mul(subscriptionSeconds)
            const fee = BigNumber.from(0)
            const streamsCount = BigNumber.from(0)
            const purchaseId = BigNumber.from(1)

            const projectId = await createProject({ payment })
            const purchaseInfo = await marketplace.getPurchaseInfo(projectId, subscriptionSeconds, chainId, purchaseId)

            expect(purchaseInfo[0]).to.equal(beneficiaryAddress)
            expect(purchaseInfo[1]).to.equal(pricingTokenAddress)
            expect(purchaseInfo[2]).to.equal(price)
            expect(purchaseInfo[3]).to.equal(fee)
            expect(purchaseInfo[4]).to.equal(purchaseId)
            expect(purchaseInfo[5]).to.equal(streamsCount)
        })

        it('getSubscriptionInfo - positivetest', async (): Promise<void> => {
            const projectId = await createProject()
            const purchaseId = BigNumber.from(1)
            const subscriptionInfoBefore = await marketplace.getSubscriptionInfo(projectId, other.address, purchaseId)

            expect(subscriptionInfoBefore[0]).to.be.false // isValid
            expect(subscriptionInfoBefore[1]).to.equal(0) // subEndTimestamp
            expect(subscriptionInfoBefore[2]).to.equal(purchaseId) // purchaseId

            await projectRegistry.grantSubscription(projectId, 100, other.address)
            const subscription = await projectRegistry.getSubscription(projectId, other.address)
            const subscriptionInfoAfter = await marketplace.getSubscriptionInfo(projectId, other.address, purchaseId)

            expect(subscriptionInfoAfter[0]).to.be.true // isValid
            expect(subscriptionInfoAfter[1]).to.equal(subscription.endTimestamp) // subEndTimestamp
            expect(subscriptionInfoAfter[2]).to.equal(purchaseId) // purchaseId
        })
    })
})
