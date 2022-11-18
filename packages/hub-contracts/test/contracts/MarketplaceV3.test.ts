import { waffle, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { utils } from "ethers"

import type { MarketplaceV3, DATAv2, ERC20Mintable } from "../../typechain"

import { ProductState } from "../../src/contracts/enums"

const { provider: waffleProvider } = waffle
const { parseEther, hexlify, zeroPad, toUtf8Bytes, id } = utils
const { getContractFactory } = hardhatEthers

use(waffle.solidity)

describe("MarketplaceV3", () => {
    const [
        admin,
        other,
        beneficiary,
    ] = waffleProvider.getWallets()

    const productId = "test1"
    const productIdbytes = hexlify(zeroPad(toUtf8Bytes(productId), 32))

    let token: DATAv2
    let erc20token: ERC20Mintable

    before(async () => {
        const tokenFactory = await getContractFactory("DATAv2", admin)
        token = await tokenFactory.deploy() as DATAv2
        await token.grantRole(id("MINTER_ROLE"), admin.address)
        await token.mint(admin.address, parseEther("1000"))
        await token.mint(other.address, parseEther("1000"))

        const otherTokenFactory = await getContractFactory("ERC20Mintable", admin)
        erc20token = await otherTokenFactory.deploy() as ERC20Mintable
    })

    async function deployMarketplace(): Promise<MarketplaceV3> {
        const marketFactory = await getContractFactory("MarketplaceV3")
        const marketFactoryTx = await upgrades.deployProxy(marketFactory, [], { kind: 'uups' })
        const market = await marketFactoryTx.deployed() as MarketplaceV3
        return market
    }

    describe("UUPS upgradeability", () => {
        it("works before and after upgrading", async () => {
            // deploy the current version of the marketplace
            const market = await deployMarketplace()

            // upgrade the marketplace to the new version
            const marketNewFactory = await getContractFactory("Marketplace") // TODO: replace with the new marketplace contract
            const marketNew = await upgrades.upgradeProxy(market, marketNewFactory)

            expect(market.address)
                .to.equal(marketNew.address)
        })
    })

    describe("Allow a token address to be passed when creating a product", () => {
        it("creates a product with custom token", async () => {
            const market = await deployMarketplace()
            const productName = productId
            const productOwner = admin.address
            const productBeneficiary = beneficiary.address
            const productPricePerSecond = 1 // in customToken
            const productCurrency = token.address
            const minimumSubscriptionSeconds = 1
            const requiresWhitelist = false

            await expect(await market.createProduct(
                productIdbytes,
                productName,
                productBeneficiary,
                productPricePerSecond,
                productCurrency,
                minimumSubscriptionSeconds))
                .to.emit(market, "ProductCreated")
                .withArgs(
                    productOwner,
                    productIdbytes,
                    productName,
                    productBeneficiary,
                    productPricePerSecond,
                    productCurrency,
                    minimumSubscriptionSeconds
                )

            const res = await market.getProduct(productIdbytes)
            const actual = String([
                res[0],
                res[1],
                res[2],
                res[3].toNumber(),
                res[4],
                res[5].toNumber(),
                res[6],
                res[7]
            ])
            const expected = String([
                productName,
                productOwner,
                productBeneficiary,
                productPricePerSecond,
                productCurrency,
                minimumSubscriptionSeconds,
                ProductState.Deployed,
                requiresWhitelist
            ])
            expect(actual).to.equal(expected)
        })
    })

    describe("Creating, deleting products in marketplace", () => {
        it("creates a product with correct params", async () => {
            const market = await deployMarketplace()
            const productName = productId
            const productOwner = admin.address
            const productBeneficiary = beneficiary.address
            const productPricePerSecond = 1
            const productCurrency = token.address
            const minimumSubscriptionSeconds = 1
            const requiresWhitelist = false

            await expect(await market.createProduct(
                productIdbytes,
                productName,
                productBeneficiary,
                productPricePerSecond,
                productCurrency,
                minimumSubscriptionSeconds))
                .to.emit(market, "ProductCreated")
                .withArgs(
                    productOwner,
                    productIdbytes,
                    productName,
                    productBeneficiary,
                    productPricePerSecond,
                    productCurrency,
                    minimumSubscriptionSeconds
                )

            const res = await market.getProduct(productIdbytes)
            const actual = String([
                res[0],
                res[1],
                res[2],
                res[3].toNumber(),
                res[4],
                res[5].toNumber(),
                res[6],
                res[7]
            ])
            const expected = String([
                productName,
                productOwner,
                productBeneficiary,
                productPricePerSecond,
                productCurrency,
                minimumSubscriptionSeconds,
                ProductState.Deployed,
                requiresWhitelist
            ])
            expect(actual).to.equal(expected)
        })

        it("will not accept empty product ID", async () => {
            const market = await deployMarketplace()
            const productIdEmptyString = hexlify(zeroPad(toUtf8Bytes(''), 32))
            await expect(market.createProduct(productIdEmptyString, "test", admin.address, 1, token.address, 1))
                .to.be.revertedWith('error_nullProductId')
        })

        it("can only be deleted/modified by owner", async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await expect(market.connect(other).deleteProduct(productIdbytes))
                .to.be.revertedWith("error_productOwnersOnly")
            await expect(market.connect(other).updateProduct(productIdbytes, "lol", beneficiary.address, 2, token.address, 2, false))
                .to.be.revertedWith("error_productOwnersOnly")
            await expect(market.connect(other).offerProductOwnership(productIdbytes, other.address))
                .to.be.revertedWith("error_productOwnersOnly")
        })

        it("deletes the previously created product", async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await expect(await market.deleteProduct(productIdbytes))
                .to.emit(market, "ProductDeleted")
                .withArgs(admin.address, productIdbytes, productId, admin.address, 1, token.address, 1)
        })

        it("can only be redeployed by owner", async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await expect(market.connect(other).redeployProduct(productIdbytes))
                .to.be.revertedWith("error_productOwnersOnly")
        })

        it("redeploys the previously deleted product", async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await market.deleteProduct(productIdbytes)
            await expect(market.redeployProduct(productIdbytes))
                .to.emit(market, "ProductRedeployed")
                .withArgs(admin.address, productIdbytes, productId, admin.address, 1, token.address, 1)
        })

        it("allows product be updated", async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await expect(market.updateProduct(productIdbytes, productId, beneficiary.address, 2, token.address, 2, false))
                .to.emit(market, "ProductUpdated")
                .withArgs(admin.address, productIdbytes, productId, beneficiary.address, 2, token.address, 2)
        })

        it("allows ownership be transferred", async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await expect(await market.offerProductOwnership(productIdbytes, other.address))
                .to.emit(market, "ProductOwnershipOffered")
                .withArgs(admin.address, productIdbytes, other.address)

            await expect(await market.connect(other).claimProductOwnership(productIdbytes))
                .to.emit(market, "ProductOwnershipChanged")
                .withArgs(other.address, productIdbytes, admin.address)
        })

        it("claiming fails if not designated as newOwnerCandidate", async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await expect(market.connect(other).claimProductOwnership(productIdbytes))
                .to.be.revertedWith('error_notPermitted')
        })
    })

    describe('Whitelist', () => {
        it('purchase rejected if not on whitelist', async () => {
            const market: MarketplaceV3 = await deployMarketplace()
            await market.createProductWithWhitelist(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await expect(market.buy(productIdbytes, 100))
                .to.be.revertedWith('error_whitelistNotAllowed')
        })

        it('non-owner cant approve whitelist', async () => {
            const market: MarketplaceV3 = await deployMarketplace()
            await market.createProductWithWhitelist(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await expect(market.connect(other).whitelistApprove(productIdbytes, beneficiary.address))
                .to.be.revertedWith("error_productOwnersOnly")
        })

        it('owner can approve whitelist and buyer can buy', async () => {
            const market: MarketplaceV3 = await deployMarketplace()
            await token.connect(other).approve(market.address, 1000)
            await market.createProductWithWhitelist(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await expect(market.whitelistApprove(productIdbytes, other.address))
                .to.emit(market, "WhitelistApproved")
                .withArgs(productIdbytes, other.address)
            await expect(market.connect(other).buy(productIdbytes, 100))
                .to.emit(market, "NewSubscription")
            expect(await market.hasValidSubscription(productIdbytes, other.address))
                .to.be.true
        })

        it('onwer can reject whitelist and buyer cannot buy', async () => {
            const market: MarketplaceV3 = await deployMarketplace()
            await market.createProductWithWhitelist(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await expect(market.whitelistReject(productIdbytes, beneficiary.address))
                .to.emit(market, "WhitelistRejected")
                .withArgs(productIdbytes, beneficiary.address)
            await token.approve(beneficiary.address, 1000)
            await expect(market.buy(productIdbytes, 100))
                .to.be.revertedWith("error_whitelistNotAllowed")
        })

        it('whitelist request works', async () => {
            const market: MarketplaceV3 = await deployMarketplace()
            await market.createProductWithWhitelist(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await expect(market.connect(other).whitelistRequest(productIdbytes))
                .to.emit(market, "WhitelistRequested")
                .withArgs(productIdbytes, other.address)
            // should fail if already on whitelist
            await expect(market.connect(other).whitelistRequest(productIdbytes))
                .to.revertedWith("error_whitelistRequestAlreadySubmitted")
            await token.approve(other.address, 1000)
            // should fail if whitelist not approved
            await expect(market.connect(beneficiary).buy(productIdbytes, 100))
                .to.revertedWith("error_whitelistNotAllowed")
        })

        it('can activate and deactivate whitelist feature', async () => {
            const market: MarketplaceV3 = await deployMarketplace()
            await market.createProductWithWhitelist(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await expect(market.connect(other).whitelistRequest(productIdbytes))
                .to.emit(market, "WhitelistRequested")
                .withArgs(productIdbytes, other.address)
            await expect(market.setRequiresWhitelist(productIdbytes, true))
                .to.emit(market, "WhitelistEnabled")
                .withArgs(productIdbytes)
            await expect(market.whitelistRequest(productIdbytes))
                .to.emit(market, "WhitelistRequested")
                .withArgs(productIdbytes, admin.address)
            // should fail before whitelist is approved
            await expect(market.buy(productIdbytes, 100))
                .to.revertedWith("error_whitelistNotAllowed")
            await expect(market.whitelistApprove(productIdbytes, admin.address))
                .to.emit(market, "WhitelistApproved")
                .withArgs(productIdbytes, admin.address)
            // approve spend before buy
            await token.approve(market.address, 1000)
            await expect(market.buy(productIdbytes, 100))
                .to.emit(market, "NewSubscription")
            await expect(market.setRequiresWhitelist(productIdbytes, false))
                .to.emit(market, "WhitelistDisabled")
                .withArgs(productIdbytes)
            // now whitelist should be disabled
            await token.connect(other).approve(market.address, 1000)
            await expect(market.connect(other).buy(productIdbytes, 100))
                .to.emit(market, "NewSubscription")
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

            await market.createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await market.connect(other).buy(productIdbytes, 1000)

            // fee is correct
            const ownerAfter = await token.balanceOf(admin.address)
            const sellerAfter = await token.balanceOf(beneficiary.address)
            // owner receives fee
            expect(ownerAfter.sub(ownerBefore)).to.equal(250)
            // seller receives price - fee
            expect(sellerAfter.sub(sellerBefore)).to.equal(750)
        })

        it.skip('works for plain ERC20 tokens (no transferAndCall)', async () => {
            const market = await deployMarketplace()
            await erc20token.mint(other.address, parseEther('10000'))
            await erc20token.connect(other).approve(market.address, parseEther('1000'))
            await market.createProduct(productIdbytes, productId, beneficiary.address, parseEther('1'), erc20token.address, 1)
            await expect(market.connect(other).buy(productIdbytes, 1000))
                .to.emit(market, "NewSubscription")

            // check subscription
            expect(await market.hasValidSubscription(productIdbytes, other.address))

            // check balance
            expect(await erc20token.balanceOf(beneficiary.address)).to.equal(parseEther('1000'))
        })

        it('fails for bad arguments', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)

            await expect(market.buy(productIdbytes, 0))
                .to.be.revertedWith('error_newSubscriptionTooSmall')

            await expect(market.connect(other).buy(productIdbytes, 0))
                .to.be.revertedWith('error_newSubscriptionTooSmall')
        })

        it('fails if allowance not given', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await expect(market.buy(productIdbytes, 100))
                .to.be.revertedWith('ERC20: transfer amount exceeds allowance')
        })

        it('fails if too little allowance was given', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await token.approve(market.address, 99)
            await expect(market.buy(productIdbytes, 100))
                .to.be.revertedWith('ERC20: transfer amount exceeds allowance')
        })

        it('works if enough allowance was given', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)
            await token.approve(market.address, 1000)
            await expect(market.buy(productIdbytes, 100))
                .to.emit(market, 'NewSubscription')
                // TODO: test for endTtimestamps
            expect(await market.hasValidSubscription(productIdbytes, admin.address))
                .to.be.true
        })

        it('can pay to non-contract addresses', async () => {
            const market = await deployMarketplace()
            const sellerAddress = '0x1234567890123456789012345678901234567890'
            const balanceBefore = await token.balanceOf(sellerAddress)

            await token.approve(market.address, 100)
            await market.createProduct(productIdbytes, productId, sellerAddress, 1, token.address, 1)
            await market.updateProduct(productIdbytes, 'test', sellerAddress, 1, token.address, 1, false)
            await market.buy(productIdbytes, 100)
            const balanceAfter = await token.balanceOf(sellerAddress)

            expect(balanceBefore).to.equal(0)
            expect(balanceAfter).to.equal(100)
        })

        it('can buy products in one transaction (transferAndCall)', async () => {
            const market = await deployMarketplace()

            const pricePerSecond = 2
            await market.createProduct(productIdbytes, productId, admin.address, pricePerSecond, token.address, 1)

            // initialize subscription endTimestamp to block.timestamp + 1
            await market.grantSubscription(productIdbytes, 1, admin.address)
            const subscription = await market.getSubscriptionTo(productIdbytes)

            const pricingTokenIn = 100
            const expectedEndTimestamp = subscription.endTimestamp.add(pricingTokenIn / pricePerSecond)

            await expect(token.transferAndCall(market.address, parseEther(String(pricingTokenIn)), productIdbytes))
                .to.emit(market, 'Subscribed')
                .withArgs(productIdbytes, admin.address, expectedEndTimestamp)
        })
    })

    describe('Subscription', () => {
        const testToleranceSeconds = 5 // TODO: might not be needed

        it('grant fails for non-owner', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            await expect(market.connect(other).grantSubscription(productIdbytes, 100, other.address))
                .to.be.revertedWith("error_productOwnersOnly")
        })

        it('grant works for owner', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1)
            const subBefore = await market.connect(other).getSubscriptionTo(productIdbytes)
            await market.grantSubscription(productIdbytes, 100, other.address)
            const subAfter = await market.connect(other).getSubscriptionTo(productIdbytes)
            expect(subAfter.isValid)
                .to.be.true
            expect(subAfter.endTimestamp.sub(subBefore.endTimestamp))
                .to.be.gt(100 - testToleranceSeconds)
        })

        it('can be extended', async () => {
            const market = await deployMarketplace()
            await token.approve(market.address, 1000)
            await market.createProduct(productIdbytes, productId, admin.address, 1, token.address, 1)

            const subBefore = await market.getSubscriptionTo(productIdbytes)
            await market.buy(productIdbytes, 100)
            const subAfter = await market.getSubscriptionTo(productIdbytes)

            expect(subAfter.isValid)
                .to.be.true
            expect(subAfter.endTimestamp.sub(subBefore.endTimestamp))
                .to.be.gt(100 - testToleranceSeconds)
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

        it('can halt product creation and buying except for the owner', async () => {
            const market = await deployMarketplace()
            await token.approve(market.address, 1000)
            await token.connect(other).approve(market.address, 1000)

            // anyone can create products
            await expect(market.createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1))
                .to.emit(market, "ProductCreated")
            await expect(market.connect(other).buy(productIdbytes, 100))
                .to.emit(market, "Subscribed")

            await expect(market.halt())
                .to.emit(market, "Halted")

            // market is halted => owner can create products
            const productId1 = "test1_halt"
            const productId1bytes = hexlify(zeroPad(toUtf8Bytes(productId1), 32))
            await expect(market.createProduct(productId1bytes, productId1, beneficiary.address, 1, token.address, 1))
                .to.emit(market, "ProductCreated")
            await expect(market.buy(productId1bytes, 100))
                .to.emit(market, "Subscribed")

            // market is halted => other users can NOT create products
            const productId2 = "test2_halt"
            const productId2bytes = hexlify(zeroPad(toUtf8Bytes(productId2), 32))
            await expect(market.connect(other).createProduct(productId2bytes, productId2, beneficiary.address, 1, token.address, 1))
                .to.be.revertedWith("error_halted")
            await expect(market.buy(productId2bytes, 100))
                .to.be.revertedWith("error_notFound")

            await expect(market.resume())
                .to.emit(market, "Resumed")

            // market is resumed => anyone can create products
            const productId3 = "test3_halt"
            const productId3bytes = hexlify(zeroPad(toUtf8Bytes(productId3), 32))
            await expect(market.connect(other).createProduct(productId3bytes, productId3, beneficiary.address, 1, token.address, 1))
                .to.emit(market, "ProductCreated")
            await expect(market.connect(other).buy(productId1bytes, 100))
                .to.emit(market, "Subscribed")
        })

        it('can halt subscription and product ownership transfers', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1)

            // can offerProductOwnership, can claimProductOwnership
            await expect(market.offerProductOwnership(productIdbytes, beneficiary.address))
                .to.emit(market, "ProductOwnershipOffered")
            await expect(market.connect(beneficiary).claimProductOwnership(productIdbytes))
                .to.emit(market, "ProductOwnershipChanged")
            await token.approve(market.address, 1000)
            await token.connect(other).approve(market.address, 1000)
            await expect(market.connect(other).buy(productIdbytes, 100))
                .to.emit(market, "Subscribed")

            await market.halt()

            // market is halted => can offerProductOwnership, but can NOT claimProductOwnership
            await expect(market.connect(beneficiary).offerProductOwnership(productIdbytes, other.address))
                .to.emit(market, "ProductOwnershipOffered")
            await expect(market.connect(other).claimProductOwnership(productIdbytes))
                .to.be.revertedWith("error_halted")

            // market is resumed => can claimProductOwnership
            await market.resume()
            await expect(market.connect(other).claimProductOwnership(productIdbytes))
                .to.emit(market, "ProductOwnershipChanged")
        })

        it('can control all products', async () => {
            const market = await deployMarketplace()
            await market.createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1)

            await expect(market.connect(other).deleteProduct(productIdbytes))
                .to.be.revertedWith("error_productOwnersOnly")
            // admin can deleteProduct
            await expect(market.deleteProduct(productIdbytes))
                .to.emit(market, "ProductDeleted")

            await expect(market.connect(other).redeployProduct(productIdbytes))
                .to.be.revertedWith("error_productOwnersOnly")
            // admin can redeployProduct
            await expect(market.redeployProduct(productIdbytes))
                .to.emit(market, "ProductRedeployed")

            await expect(market.connect(other).updateProduct(productIdbytes, productId, beneficiary.address, 2, token.address, 2, false))
                .to.be.revertedWith("error_productOwnersOnly")
            // admin can updateProduct
            await expect(market.updateProduct(productIdbytes, "test", beneficiary.address, 2, token.address, 2, false))
                .to.emit(market, "ProductUpdated")

            await expect(market.connect(other).offerProductOwnership(productIdbytes, other.address))
                .to.be.revertedWith("error_productOwnersOnly")
            // admin can offerProductOwnership
            await expect(market.offerProductOwnership(productIdbytes, other.address))
                .to.emit(market, "ProductOwnershipOffered")
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
            // only admin2 can createProduct on halted market
            await expect(market.connect(admin).createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1))
                .to.be.revertedWith("error_halted")
            await expect(market.connect(admin2).createProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1))
                .to.emit(market, "ProductCreated")

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

        it('can create products for other users', async () => {
            const market = await deployMarketplace()
            const productOwner = other

            await market.ownerCreateProduct(productIdbytes, productId, beneficiary.address, 1, token.address, 1, productOwner.address)
            expect((await market.getProduct(productIdbytes))[1])
                .to.equal(productOwner.address)

            // the user for which the product was created can update the product
            await expect(market.connect(productOwner).updateProduct(productIdbytes, productId, beneficiary.address, 2, token.address, 2, false))
                .to.emit(market, "ProductUpdated")
                .withArgs(productOwner.address, productIdbytes, productId, beneficiary.address, 2, token.address, 2)
        })
    })
})
