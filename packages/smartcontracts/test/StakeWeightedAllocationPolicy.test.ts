import { waffle, upgrades, ethers as hardhatEthers } from 'hardhat'
import { expect, use } from 'chai'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { Bounty } from '../typechain/Bounty'
import { Contract, ContractFactory, BigNumber, utils } from 'ethers'
import { IERC677 } from '../typechain/IERC677'
import { IAllocationPolicy } from '../typechain'

const { provider: waffleProvider } = waffle
const { parseEther } = utils
const { provider, getContractFactory } = hardhatEthers

use(waffle.solidity)

describe('StakeWeightedAllocationPolicy', (): void => {
    const wallets = waffleProvider.getWallets()
    const adminWallet = wallets[0]
    const brokerWallet = wallets[1]
    const broker2Wallet = wallets[2]
    const trustedForwarderAddress: string = wallets[9].address
    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let tokenAddress: string
    let token: IERC677
    let tokenFromBroker: IERC677
    let allocationPolicy: IAllocationPolicy
    let bountyCounter = 0
    let bountyFromAdmin: Contract
    let bountyFromBroker: Contract

    const timestepSeconds = 1000
    const tokensPerSecond = parseEther("1")

    before(async () => {
        const tokenTxr = await getContractFactory('LinkToken', adminWallet)
        token = await tokenTxr.deploy() as IERC677
        tokenAddress = token.address
        tokenFromBroker = token.connect(brokerWallet)

        const apF = await getContractFactory('StakeWeightedAllocationPolicy', adminWallet)
        const apTx = await apF.deploy() as Contract
        allocationPolicy = await apTx.connect(adminWallet).deployed() as IAllocationPolicy

        const agreementFactory = await getContractFactory('Bounty')
        const agreementTemplate = await agreementFactory.deploy()
        await agreementTemplate.deployed()

        bountyFactoryFactory = await getContractFactory('BountyFactory', adminWallet)
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
            [ agreementTemplate.address, trustedForwarderAddress, tokenAddress ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory

        await (await token.transfer(brokerWallet.address, parseEther('100'))).wait()
        await (await token.transfer(broker2Wallet.address, parseEther('100'))).wait()
    })

    beforeEach(async () => {
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty-" + bountyCounter++)
        const res = await agreementtx.wait()

        const newBountyAddress = res.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        console.log("bounty " + newBountyAddress)

        const agreementFactory = await getContractFactory('Bounty')
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty

        const setPolicyTx = await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, tokensPerSecond)
        await setPolicyTx.wait()

        await token.approve(bountyFromAdmin.address, parseEther("100000"))
        await bountyFromAdmin.sponsor(parseEther("100000"))
    })

    it('allocates correctly for single broker (positive test)', async () => {
        const tokensBefore = await token.balanceOf(brokerWallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        // t = 0: join
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther("1"), brokerWallet.address)).wait()
        const allocationBefore = await bountyFromBroker.getAllocation(brokerWallet.address) as BigNumber

        // t = timestep: leave
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + timestepSeconds + 1]) // TODO: why +1?
        await provider.send('evm_mine', [0])
        const allocationAfter = (await bountyFromBroker.getAllocation(brokerWallet.address))

        await (await bountyFromBroker.leave()).wait()
        const tokensAfter = await token.balanceOf(brokerWallet.address)

        expect(allocationBefore.toString()).to.equal("0")
        expect(allocationAfter.toString()).to.equal(tokensPerSecond.mul(timestepSeconds).toString())

        // broker now has his stake back and additional winnings
        expect(tokensAfter.sub(tokensBefore).toString()).to.equal(tokensPerSecond.mul(timestepSeconds + 1).toString())
    })

    it('allocates correctly for two brokers, same weight, different join, leave times (positive test)', async function(): Promise<void> {
        //      t0       : broker1 joins
        // t1 = t0 + 1000: broker2 joins
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + half-of-half = 75% of the winnings
        // broker2 should have half-of-half = 25% of the winnings
        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)
        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        // t = 0: broker1 joins
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther("1"), brokerWallet.address)).wait()

        // t = timestep: broker2 joins
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + timestepSeconds])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, parseEther("1"), broker2Wallet.address)).wait()

        // t = 3 * timestep: broker2 leaves
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + (3 * timestepSeconds)])
        await provider.send('evm_mine', [0])
        await (await bountyFromBroker2.leave()).wait()

        // t = 4 * timestep: broker1 leaves
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + (4 * timestepSeconds)])
        await provider.send('evm_mine', [0])
        await (await bountyFromBroker.leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(brokerWallet.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2Wallet.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = tokensPerSecond.mul(timestepSeconds * 3)
        const tokensBroker2Expected = tokensPerSecond.mul(timestepSeconds)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
        const unallocatedWei = await bountyFromBroker.getUnallocatedWei() as BigNumber
        expect(unallocatedWei.toString()).to.equal("100000000000000000000000")
    })

    it('allocates correctly for two brokers, different weight, different join, leave times (positive test)', async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1
        // t1 = t0 + 1000: broker2 joins, stakes 4
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + 20% of half = 60% of the winnings
        // broker2 should have 80% of half = 40% of the winnings
        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)
        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        // t0: broker1 joins
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('0.1'), "0x")).wait()

        // t1: broker2 joins
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + timestepSeconds])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, parseEther('0.4'), "0x")).wait()

        // t2: broker2 leaves
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + 3 * timestepSeconds])
        await provider.send('evm_mine', [0])
        await (await bountyFromBroker2.leave()).wait()

        // t3: broker1 leaves
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + 4 * timestepSeconds])
        await provider.send('evm_mine', [0])
        await (await bountyFromBroker.leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(brokerWallet.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2Wallet.address)).sub(tokensBroker2Before)
        const totalTokensExpected = tokensPerSecond.mul(4 * timestepSeconds)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(60)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(40)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
    })

    // TODO: add this required staying period feature
    it.skip('deducts penalty from a broker that leaves too early', async function(): Promise<void> {
        await (await tokenFromBroker.transfer(adminWallet.address, await token.balanceOf(brokerWallet.address))).wait()
        await (await token.transfer(brokerWallet.address, parseEther('10'))).wait()
        const tokensBefore = await token.balanceOf(brokerWallet.address)

        // await (await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, BigNumber.from('100000'))).wait()

        await token.approve(bountyFromAdmin.address, parseEther('1'))
        await bountyFromAdmin.sponsor(parseEther('1'))

        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('0.5'), "0x")).wait()

        await(await bountyFromBroker.leave()).wait()
        const tokensAfter = await token.balanceOf(brokerWallet.address)

        // broker lost 10% of his stake
        expect(tokensBefore.sub(parseEther('0.05')).eq(tokensAfter)).to.be.true
    })
})
