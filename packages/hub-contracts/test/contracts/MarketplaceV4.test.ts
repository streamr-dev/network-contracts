import { waffle, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { BigNumber, utils, constants } from "ethers"
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

import type { DATAv2, ERC20Mintable, MarketplaceV4, ProjectRegistry, StreamRegistryV4 } from "../../typechain"
import { MinimalForwarder } from "../../typechain/MinimalForwarder"
import { RemoteMarketplace } from "../../typechain/RemoteMarketplace"
import { MockInbox__factory, MockOutbox__factory, TestRecipient__factory } from "@hyperlane-xyz/core"
import { utils as hyperlaneUtils } from "@hyperlane-xyz/utils"

const { provider: waffleProvider } = waffle
const { parseEther, hexlify, zeroPad, toUtf8Bytes, id } = utils
const { getContractFactory } = hardhatEthers
const { addressToBytes32} = hyperlaneUtils

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

export const log = (..._: unknown[]): void => { /* skip logging */ }
// export const { log } = console

use(waffle.solidity)

describe("Marketplace", () => {
    const [
        admin,
        buyer,
        other,
        beneficiary,
        forwarder,
    ] = waffleProvider.getWallets()

    let token: DATAv2
    let otherToken: ERC20Mintable
    let marketplace: MarketplaceV4
    let minimalForwarder: MinimalForwarder
    let projectRegistry: ProjectRegistry
    let streamRegistry: StreamRegistryV4

    const deployedOnDomainId = 0x706f6c79 // domain id for polygon mainnet
    const domainIds: number[] = [] // not the actual network ids => unique ids assigned by hyperlane
    const paymentDetailsDefault: any[] = [] // PaymentDetailsByChain[]
    const paymentDetailsFreeProject: any[] = [] // PaymentDetailsByChain[]

    before(async () => {
        await deployERC20()
        await deployOtherERC20()
        await deployMinimalForwarder()
        await deployStreamRegistry()
        await deployProjectRegistry()
        marketplace = await deployMarketplace()

        domainIds.push(deployedOnDomainId)
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
        otherToken = await otherTokenFactory.deploy() as ERC20Mintable

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
        const contractFactory = await getContractFactory("StreamRegistryV4", admin)
        const contractFactoryTx = await upgrades.deployProxy(
            contractFactory,
            ["0x0000000000000000000000000000000000000000", minimalForwarder.address],
            { kind: 'uups' })
        streamRegistry = await contractFactoryTx.deployed() as StreamRegistryV4
        log("   - StreamRegistry deployed at: ", streamRegistry.address)

    }

    async function deployProjectRegistry(): Promise<void> {
        log("Deploying ProjectRegistry: ")
        const contractFactory = await getContractFactory("ProjectRegistry", admin)
        const contractFactoryTx = await upgrades.deployProxy(contractFactory, [streamRegistry.address], { kind: 'uups' })
        projectRegistry = await contractFactoryTx.deployed() as ProjectRegistry
        log("   - ProjectRegistry deployed at: ", projectRegistry.address)
    }

    async function deployMarketplace(): Promise<MarketplaceV4> {
        log("Deploying MarketplaceV4: ")
        const marketFactoryV4 = await getContractFactory("MarketplaceV4", admin)
        const marketFactoryV4Tx = await upgrades.deployProxy(marketFactoryV4, [projectRegistry.address, deployedOnDomainId], { kind: 'uups' })
        const market = await marketFactoryV4Tx.deployed() as MarketplaceV4
        log("   - MarketplaceV4 deployed at: ", market.address)
        // grant trusted role to marketpalce contract => needed for granting permissions to buyers
        await projectRegistry.grantRole(id("TRUSTED_ROLE"), market.address)
        return market
    }

    async function createProject({
        chains = domainIds,
        payment = paymentDetailsDefault,
        minimumSubscriptionSeconds = 1,
        isPublicPurchable = true,
        metadata = ""
    } = {}): Promise<string> {
        const name = 'project-' + Math.round(Math.random() * 1000000)
        const projectId = hexlify(zeroPad(toUtf8Bytes(name), 32))
        await projectRegistry
            .createProject(projectId, chains, payment, [], minimumSubscriptionSeconds, isPublicPurchable, metadata)
        log("   - created project: ", projectId)
        return projectId
    }

    describe("UUPS upgradeability", () => {
        it("works before and after upgrading", async () => {
            const marketFactoryV4 = await getContractFactory("MarketplaceV4", admin)
            const marketFactoryV4Tx = await upgrades.deployProxy(marketFactoryV4, [projectRegistry.address, deployedOnDomainId], { kind: 'uups' })
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
            await projectRegistry.updateProject(projectId, domainIds, paymentDetails, [], 1, 'metadata')
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

        it('buy - positivetest - beneficiary can react on project purchase', async () => {
            const marketFactoryV4 = await getContractFactory("MarketplaceV4", admin)
            const marketFactoryV4Tx = await upgrades.deployProxy(marketFactoryV4, [projectRegistry.address, deployedOnDomainId], { kind: 'uups' })
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
                .createProject(projectId, domainIds, paymentDetails1, [], 1, true, 'metadata')
            expect(await token.balanceOf(beneficiaryAddress))
                .to.equal(0)
            await token.approve(market.address, 1000)
            await expect(market.buy(projectId, subscriptionSeconds))
                .to.emit(mockBeneficiary, "OnTokenTransferCalled") // will notify beneficiary
            expect(await token.balanceOf(beneficiaryAddress))
                .to.equal(subscriptionSeconds * pricePerSecond)

            // change pricing token to ERC20
            await projectRegistry
                .updateProject(projectId, domainIds, paymentDetails2, [], 1, 'metadata')
            await otherToken.approve(market.address, 1000)
            expect(await otherToken.balanceOf(beneficiaryAddress))
                .to.equal(0)
            await expect(market.buy(projectId, subscriptionSeconds))
                .to.not.emit(mockBeneficiary, "OnTokenTransferCalled") // will NOT notify beneficiary
            expect(await otherToken.balanceOf(beneficiaryAddress))
                .to.equal(subscriptionSeconds * pricePerSecond)
        })

        it('buy - negativetest - unable to purchase free projects (pricePerSecond=0)', async () => {
            const freeProjectId = await createProject({ payment: paymentDetailsFreeProject })
            
            await expect(marketplace.buy(freeProjectId, 100))
                .to.be.revertedWith("error_freeProjectsNotSupportedOnMarketplace")
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

        it('can be transferred', async () => {
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
    })

    describe('Metatransactions', (): void => {
        before(async () => {
            const trustedForwarderRole = await projectRegistry.TRUSTED_FORWARDER_ROLE()
            await projectRegistry.grantRole(trustedForwarderRole, minimalForwarder.address)

            // each unit test must have at least subscriptionSeconds * pricePerSecond for mint/approve
            await token.mint(buyer.address, 10000)
            await token.connect(buyer).approve(marketplace.address, 10000)
        })

        async function prepareBuyMetatx(minimalForwarder: MinimalForwarder, signKey: string, gas = '1000000') {
            const projectId = await createProject()
            const subscriptionSeconds = 100

            // buyer is creating and signing transaction, forwarder is posting it and paying for gas
            const data = marketplace.interface.encodeFunctionData('buy', [projectId, subscriptionSeconds])
            const req = {
                from: buyer.address,
                to: marketplace.address,
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
            return {req, sign, projectId, subscriptionSeconds}
        }

        it('isTrustedForwarder - positivetest', async (): Promise<void> => {
            expect(await marketplace.isTrustedForwarder(minimalForwarder.address))
                .to.be.true
        })

        it('buy - positivetest', async (): Promise<void> => {
            const {req, sign, projectId} = await prepareBuyMetatx(minimalForwarder.connect(forwarder), buyer.privateKey)
            expect(await minimalForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
                .to.be.false

            await minimalForwarder.connect(forwarder).execute(req, sign)

            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
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
            const {req, sign, projectId} = await prepareBuyMetatx(wrongForwarder.connect(forwarder), buyer.privateKey)
            expect(await wrongForwarder.connect(forwarder).verify(req, sign))
                .to.be.true

            // check that the project doesn't have a valid subscription
            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
                .to.be.false

            await wrongForwarder.connect(forwarder).execute(req, sign)

            // internal call will have failed => subscription was not extended
            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
                .to.be.false
        })

        it('buy - negativetest - wrong signature', async (): Promise<void> => {
            const wrongKey = other.privateKey // buyer.privateKey would be correct
            const {req, sign} = await prepareBuyMetatx(minimalForwarder, wrongKey)
            expect(await minimalForwarder.verify(req, sign))
                .to.be.false
            await expect(minimalForwarder.execute(req, sign))
                .to.be.revertedWith('MinimalForwarder: signature does not match request')
        })

        it('buy - negativetest - not enough gas in internal transaction call', async (): Promise<void> => {
            const {req, sign, projectId} = await prepareBuyMetatx(minimalForwarder, buyer.privateKey, '1000')
            expect(await minimalForwarder.verify(req, sign))
                .to.be.true

            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
                .to.be.false
            await minimalForwarder.execute(req, sign)
            // internal call will have failed
            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
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
            const {req: reqOld, sign: signOld, projectId: projectIdOld}: any = await prepareBuyMetatx(minimalForwarder, buyer.privateKey)
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
            const {req, sign, projectId} = await prepareBuyMetatx(newForwarder, buyer.privateKey)
            expect(await newForwarder.verify(req, sign))
                .to.be.true
            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
                .to.be.false
            await newForwarder.execute(req, sign)
            expect(await projectRegistry.hasValidSubscription(projectId, buyer.address))
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
            const purchaseId = BigNumber.from(1)
            
            const projectId = await createProject({ payment })
            const purchaseInfo = await marketplace.getPurchaseInfo(projectId, subscriptionSeconds, deployedOnDomainId, purchaseId)
            
            expect(purchaseInfo[0]).to.equal(beneficiaryAddress)
            expect(purchaseInfo[1]).to.equal(pricingTokenAddress)
            expect(purchaseInfo[2]).to.equal(price)
            expect(purchaseInfo[3]).to.equal(fee)
            expect(purchaseInfo[4]).to.equal(purchaseId)
        })
    })

    describe('Hyperlane - cross-chain messaging', () => {
        it("should be able to send a message directly using the test recipient contract", async function () {
            const signer = (await hardhatEthers.getSigners())[0]
            const inbox = await new MockInbox__factory(signer).deploy()
            await inbox.deployed()
            const outbox = await new MockOutbox__factory(signer).deploy(originDomain, inbox.address)
            await outbox.deployed()
            const recipient = await new TestRecipient__factory(signer).deploy()
            const data = toUtf8Bytes("This is a test message")
        
            await outbox.dispatch(1, addressToBytes32(recipient.address), data)
            await inbox.processNextPendingMessage()
        
            const dataReceived = await recipient.lastData()
            expect(dataReceived).to.eql(hexlify(data))
        })

        const originDomain = 1 // the domain id of the chain RemoteMarketplace is deployed on
        const destinationDomain = 2 // the domain id of the chain ProjectRegistry & MarketplaceV4 are deployed on
        let sender: RemoteMarketplace // the contract the messages are sent from
        let recipient: MarketplaceV4 // the contract the messages are sent to

        before(async () => {
            recipient = marketplace
        })

        describe('RemoteMarketplace', () => {
            let inbox: any
            let outbox: any

            before(async () => {
                inbox = await new MockInbox__factory(admin).deploy()
                await inbox.deployed()
                outbox = await new MockOutbox__factory(admin).deploy(originDomain, inbox.address)
                await outbox.deployed()

                const remoteMarketFactory = await getContractFactory("RemoteMarketplace")
                const queryRouter = constants.AddressZero // TODO: add InterchainQueryRouter to dev env
                sender = await remoteMarketFactory.deploy(originDomain, queryRouter, outbox.address) as RemoteMarketplace
                await sender.addRecipient(destinationDomain, recipient.address)
                await recipient.addCrossChainInbox(originDomain, inbox.address)
                await recipient.addCrossChainMarketplace(originDomain, sender.address)
            })
    
            it("TODO: buy() - positivetest - subscription purchased on remote chain is added to source chain", async () => {})
        })
    })
})
