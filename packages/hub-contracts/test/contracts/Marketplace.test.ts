import { waffle, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { utils } from "ethers"
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

import type { DATAv2, ERC20Mintable, MarketplaceV3, MarketplaceV4, ProjectRegistry, StreamRegistryV3 } from "../../typechain"
import { MinimalForwarder } from "../../typechain/MinimalForwarder"

const { provider: waffleProvider } = waffle
const { parseEther, hexlify, zeroPad, toUtf8Bytes, id } = utils
const { getContractFactory } = hardhatEthers

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

    let projectId: string
    let token: DATAv2
    let otherToken: ERC20Mintable
    let marketplace: MarketplaceV4
    let minimalForwarder: MinimalForwarder
    let projectRegistry: ProjectRegistry
    let streamRegistry: StreamRegistryV3

    before(async () => {
        await deployERC20()
        await deployOtherERC20()
        await deployMinimalForwarder()
        await deployStreamRegistry()
        await deployProjectRegistry()
        marketplace = await deployMarketplace()
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
        const contractFactory = await getContractFactory("StreamRegistryV3", admin)
        const contractFactoryTx = await upgrades.deployProxy(
            contractFactory,
            ["0x0000000000000000000000000000000000000000", minimalForwarder.address],
            { kind: 'uups' })
        streamRegistry = await contractFactoryTx.deployed() as StreamRegistryV3
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
        // deploy the first upgradeable marketplace contract
        const marketFactoryV3 = await getContractFactory("MarketplaceV3", admin)
        const marketFactoryV3Tx = await upgrades.deployProxy(marketFactoryV3, [], { kind: 'uups' })

        // upgrade the marketplace contract to the latest version
        const marketFactory = await getContractFactory("MarketplaceV4")
        const marketFactoryTx = await upgrades.upgradeProxy(marketFactoryV3Tx.address, marketFactory)
        const market = await marketFactoryTx.deployed() as MarketplaceV4

        // initialize project registry contract for marketplace
        await market.setProjectRegistry(projectRegistry.address)
        // grant trusted role to marketpalce contract => needed for granting permissions to buyers
        await projectRegistry.grantRole(id("TRUSTED_ROLE"), market.address)

        await createProject()
        return market
    }

    async function createProject(): Promise<string> {
        const name = 'project-' + Math.round(Math.random() * 1000000)
        projectId = hexlify(zeroPad(toUtf8Bytes(name), 32))
        await projectRegistry.createProject(projectId, beneficiary.address, 1, token.address, 1, true, 'metadata-' + projectId)
        log("   - created project: ", projectId)
        return projectId
    }

    describe("UUPS upgradeability", () => {
        it("works before and after upgrading", async () => {
            const marketFactoryV3 = await getContractFactory("MarketplaceV3", admin)
            const marketFactoryV3Tx = await upgrades.deployProxy(marketFactoryV3, [], { kind: 'uups' })
            const marketplaceV3 = await marketFactoryV3Tx.deployed() as MarketplaceV3

            const marketFactoryV4 = await getContractFactory("MarketplaceV4")
            const marketFactoryV4Tx = await upgrades.upgradeProxy(marketFactoryV3Tx.address, marketFactoryV4)
            const marketplaceV4 = await marketFactoryV4Tx.deployed() as MarketplaceV4

            await marketplaceV4.setProjectRegistry(projectRegistry.address)
            
            expect(marketplaceV3.address)
                .to.equal(marketplaceV4.address)
        })
    })

    describe('Buying products', () => {
        it('setTxFee checks argument between 0...1 (inclusive)', async () => {
            const market = await deployMarketplace()
            await expect(await market.setTxFee(parseEther('1.0')))
                .to.emit(market, 'TxFeeChanged')
                .withArgs(parseEther('1.0'))
            await expect(market.setTxFee(parseEther('1.1')))
                .to.be.revertedWith('error_invalidTxFee')
        })

        it('txFee token distribution works', async () => {
            const market = await deployMarketplace()
            const fee = parseEther('0.25')
            await expect(market.setTxFee(fee))
                .to.emit(market, 'TxFeeChanged')
                .withArgs(fee)

            // enough approved with added fee
            await token.connect(other).approve(market.address, 1000)
            const ownerBefore = await token.balanceOf(admin.address)
            const sellerBefore = await token.balanceOf(beneficiary.address)

            await market.connect(other).buy(projectId, 1000)

            // fee is correct
            const ownerAfter = await token.balanceOf(admin.address)
            const sellerAfter = await token.balanceOf(beneficiary.address)
            // owner receives fee
            expect(ownerAfter.sub(ownerBefore)).to.equal(250)
            // seller receives price - fee
            expect(sellerAfter.sub(sellerBefore)).to.equal(750)
        })

        it('fails for bad arguments', async () => {
            const market = await deployMarketplace()

            await expect(market.buy(projectId, 0))
                .to.be.revertedWith('error_newSubscriptionTooSmall')
                
            await expect(market.connect(other).buy(projectId, 0))
                .to.be.revertedWith('error_newSubscriptionTooSmall')
        })

        it('fails if allowance not given', async () => {
            const market = await deployMarketplace()
            await expect(market.buy(projectId, 100))
                .to.be.revertedWith('ERC20: transfer amount exceeds allowance')
        })

        it('fails if too little allowance was given', async () => {
            const market = await deployMarketplace()
            await token.approve(market.address, 99)
            await expect(market.buy(projectId, 100))
                .to.be.revertedWith('ERC20: transfer amount exceeds allowance')
        })

        it('works if enough allowance was given', async () => {
            const market = await deployMarketplace()
            await token.approve(market.address, 1000)
            await expect(market.buy(projectId, 100))
                .to.emit(projectRegistry, 'NewSubscription')
                // TODO: test for endTtimestamps
            expect(await projectRegistry.hasValidSubscription(projectId, admin.address))
                .to.be.true
        })

        it('can pay to non-contract addresses', async () => {
            const market = await deployMarketplace()
            const sellerAddress = '0x1234567890123456789012345678901234567890'
            const balanceBefore = await token.balanceOf(sellerAddress)

            await token.approve(market.address, 100)
            await projectRegistry.updateProject(projectId, sellerAddress, 1, token.address, 1, 'metadata')
            await market.buy(projectId, 100)
            const balanceAfter = await token.balanceOf(sellerAddress)

            expect(balanceBefore).to.equal(0)
            expect(balanceAfter).to.equal(100)
        })

        it('can buy products in one transaction (transferAndCall)', async () => {
            const market = await deployMarketplace()
            
            await projectRegistry.grantSubscription(projectId, 1, admin.address)
            const subscription = await projectRegistry.getOwnSubscription(projectId)
            
            const pricingTokenIn = 100
            const pricePerSecond = 1
            const expectedEndTimestamp = subscription.endTimestamp.add(pricingTokenIn / pricePerSecond)
           
            await expect(token.transferAndCall(market.address, parseEther(String(pricingTokenIn)), projectId))
                .to.emit(projectRegistry, 'Subscribed')
                .withArgs(projectId, admin.address, expectedEndTimestamp)
        })

        it('buy - positivetest - beneficiary can react on product purchase', async () => {
            // deploy the first upgradeable marketplace contract
            const marketFactoryV3 = await getContractFactory("MarketplaceV3", admin)
            const marketFactoryV3Tx = await upgrades.deployProxy(marketFactoryV3, [], { kind: 'uups' })
            // upgrade the marketplace contract from V3 to V4
            const marketFactoryV4 = await getContractFactory("MarketplaceV4")
            const marketFactoryV4Tx = await upgrades.upgradeProxy(marketFactoryV3Tx.address, marketFactoryV4)
            const market = await marketFactoryV4Tx.deployed() as MarketplaceV4
            // initialize project registry contract for marketplace
            await market.setProjectRegistry(projectRegistry.address)
            // grant trusted role to marketpalce contract => needed for granting permissions to buyers
            await projectRegistry.grantRole(id("TRUSTED_ROLE"), market.address)

            // deploy mock beneficiary contract from which the beneficiary can react to a product purchase
            const mockBeneficiaryFactory = await getContractFactory("MockMarketplaceBeneficiary")
            const mockBeneficiary = await mockBeneficiaryFactory.deploy()

            const name = 'project-' + Math.round(Math.random() * 1000000)
            const projectId = hexlify(zeroPad(toUtf8Bytes(name), 32))
            const beneficiaryAddress = mockBeneficiary.address
            const pricePerSecond = 2
            const subscriptionSeconds = 500

            // create project with ERC677 pricingToken
            await projectRegistry
                .createProject(projectId, beneficiaryAddress, pricePerSecond, token.address, 1, true, 'metadata')
            expect(await token.balanceOf(beneficiaryAddress))
                .to.equal(0)
            await token.approve(market.address, 1000)
            await expect(market.buy(projectId, subscriptionSeconds))
                .to.emit(mockBeneficiary, "NotifyBeneficiaryOnProductPurchase") // will notify beneficiary
            expect(await token.balanceOf(beneficiaryAddress))
                .to.equal(subscriptionSeconds * pricePerSecond)

            // change pricing token to ERC20
            await projectRegistry
                .updateProject(projectId, beneficiaryAddress, pricePerSecond, otherToken.address, 1, 'metadata')
            await otherToken.approve(market.address, 1000)
            expect(await otherToken.balanceOf(beneficiaryAddress))
                .to.equal(0)
            await expect(market.buy(projectId, subscriptionSeconds))
                .to.not.emit(mockBeneficiary, "NotifyBeneficiaryOnProductPurchase") // will NOT notify beneficiary
            expect(await otherToken.balanceOf(beneficiaryAddress))
                .to.equal(subscriptionSeconds * pricePerSecond)
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
            const market = await deployMarketplace()
            await token.approve(market.address, 1000)
            await token.connect(other).approve(market.address, 1000)

            // anyone can buy products
            await expect(market.connect(other).buy(projectId, 100))
                .to.emit(projectRegistry, "Subscribed")

            await expect(market.halt())
                .to.emit(market, "Halted")

            // market is halted => admin can buy products
            await expect(market.buy(projectId, 100))
                .to.emit(projectRegistry, "Subscribed")
            // market is halted => other users can't buy products
            await expect(market.connect(other).buy(projectId, 100))
                .to.be.revertedWith("error_halted")

            await expect(market.resume())
                .to.emit(market, "Resumed")

            // market is resumed => anyone can buy products
            await expect(market.connect(other).buy(projectId, 100))
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
    })
})
