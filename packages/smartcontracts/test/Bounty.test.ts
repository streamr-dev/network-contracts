// SPDX-License-Identifier: MIT

import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
// import { BigNumber, utils, Wallet } from 'ethers'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { Bounty } from '../typechain/Bounty'
import { Contract, ContractFactory } from 'ethers'
import { IERC677 } from '../typechain/IERC677'
import { IAllocationPolicy, IJoinPolicy, ILeavePolicy } from '../typechain'

// const { deployContract } = waffle
const { provider } = waffle

// eslint-disable-next-line no-unused-vars

use(waffle.solidity)

// testcases to not forget:
// - increase stake if already joined

describe('Bounty', (): void => {
    const wallets = provider.getWallets()
    const adminWallet = wallets[0]
    const brokerWallet = wallets[1]
    const broker2Wallet = wallets[2]
    const trustedForwarderAddress: string = wallets[9].address
    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let tokenAddress: string
    let token: IERC677
    let tokenFromBroker: IERC677
    let minStakeJoinPolicy: IJoinPolicy
    let maxBrokersJoinPolicy: IJoinPolicy
    let leavePolicy: ILeavePolicy
    let allocationPolicy: IAllocationPolicy
    let bountyCounter: number = 0
    let bountyFromAdmin: Contract
    let bountyFromBroker: Contract

    before(async (): Promise<void> => {
        const tokenTxr = await ethers.getContractFactory('LinkToken', adminWallet)
        token = await tokenTxr.deploy() as IERC677
        tokenAddress = token.address
        tokenFromBroker = token.connect(brokerWallet)

        const jpMS = await ethers.getContractFactory('MinimumStakeJoinPolicy', adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        minStakeJoinPolicy = await jpMSC.connect(adminWallet).deployed() as IJoinPolicy

        const jpMaxB = await ethers.getContractFactory('MaxAmountBrokersJoinPolicy', adminWallet)
        const jpMaxBTx = await jpMaxB.deploy() as Contract
        maxBrokersJoinPolicy = await jpMaxBTx.connect(adminWallet).deployed() as IJoinPolicy

        const apF = await ethers.getContractFactory('WeightBasedAllocationPolicy', adminWallet)
        const apTx = await apF.deploy() as Contract
        allocationPolicy = await apTx.connect(adminWallet).deployed() as IAllocationPolicy

        const agreementFactory = await ethers.getContractFactory('Bounty')
        const agreementTemplate = await agreementFactory.deploy()
        await agreementTemplate.deployed()

        bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', adminWallet)
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
            [ agreementTemplate.address, trustedForwarderAddress, tokenAddress ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory

        await (await token.transfer(brokerWallet.address, ethers.utils.parseEther('100'))).wait()
        await (await token.transfer(broker2Wallet.address, ethers.utils.parseEther('100'))).wait()
    })

    beforeEach(async (): Promise<void> => {
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty-" + bountyCounter++)
        const res = await agreementtx.wait()

        const newBountyAddress = res.events?.filter(e => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        console.log("bounty " + newBountyAddress)

        const agreementFactory = await ethers.getContractFactory('Bounty')
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty
    })

    it('positivetest deploy bounty through factory, join bounty', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))).wait()
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('1'))).wait()
        let tx = await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('2'), "0x")
        await tx.wait()
    })

    it('negativetest addjoinpolicy from not-admin', async function(): Promise<void> {
        await expect(bountyFromBroker.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))).to.be.revertedWith('error_mustBeAdminRole')
    })

    it('negativetest trying to join with wrong token', async function(): Promise<void> {
        const newtokenTxr = await ethers.getContractFactory('LinkToken', adminWallet)
        const newToken = await newtokenTxr.deploy() as IERC677
        const newTokenFromAdmin = newToken.connect(adminWallet)
        // await expect(newTokenFromBroker.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x")).to.be.revertedWith('error_onlyTokenContract')
        await expect(newTokenFromAdmin.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x")).to.be.revertedWith('error_onlyTokenContract')
    })

    // this should actually fail, but there might be a hardhat bug that allows calling functions on non-existing contracts, so we skip it for now
    // it('negativetest setjoinpolicy pointing to nonexistant contract', async function(): Promise<void> {
    //     await expect(bountyFromAdmin.addJoinPolicy(wallets[4].address, ethers.BigNumber.from('2000000000000000000'))).to.be.revertedWith('error adding join policy')
    // })

    it('negativetest min stake join policy', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x")).to.be.revertedWith('error_minimum_stake')
    })

    it('negativetest max brokers join policy', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('0'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('0'), "0x")).to.be.revertedWith('error_max_brokers')
    })

    it('positivetest weightbased allocationpolicy single broker, unpenalised leaving', async function(): Promise<void> {
        const addpolicy2tx = await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, ethers.BigNumber.from('0'))
        const tokensBefore = await token.balanceOf(brokerWallet.address)
        console.log("brokerwallet address: " + brokerWallet.address)

        await addpolicy2tx.wait()

        await token.approve(bountyFromAdmin.address, ethers.utils.parseEther('1'))
        await bountyFromAdmin.sponsor(ethers.utils.parseEther('1'))

        const timeAtStart = Math.floor(Date.now() / 1000) + 60 // the 60 so we are in the future and don't interfere with time that test is running at
        const timestepSeconds = 1000
        const tokensPerSecond = 10

        await ethers.provider.send("evm_setNextBlockTimestamp", [timeAtStart])
        await ethers.provider.send('evm_mine', [0])

        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, ethers.utils.parseEther('0.5'), "0x")).wait()
        console.log("unallocated " + (await bountyFromBroker.getUnallocatedWei()).toString());

        let allocation: number = (await bountyFromBroker.getAllocation(brokerWallet.address))
        expect (allocation).to.be.equal(0)

        await ethers.provider.send("evm_setNextBlockTimestamp", [timeAtStart + timestepSeconds + 1])
        await ethers.provider.send('evm_mine', [0])

        allocation = (await bountyFromBroker.getAllocation(brokerWallet.address))
        expect (allocation).to.be.equal(timestepSeconds * tokensPerSecond)

        await (await bountyFromBroker.leave()).wait()
        const tokensAfter = await token.balanceOf(brokerWallet.address)
        // broker now has his stake back and additional winnings
        expect(tokensAfter.sub(tokensBefore).sub((timestepSeconds + 1) * 10).eq(0)).to.be.true
    })

    it('negativetest sponsor with no allowance', async function(): Promise<void> {
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther('1'))).to.be.revertedWith('')
    })

    it('positivetest weightbased allocationpolicy two brokers, different join, leave times', async function(): Promise<void> {
        //      t0       : broker1 joins
        // t1 = t0 + 1000: broker2 joins
        // t3 = t0 + 3000: broker 2 leaves
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker 1 should have half + half-of-half of the winnings
        // broker 2 should have half-of-half = 25% of the winnings
        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)
        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        console.log("tokens before: " + tokensBroker1Before.toString())
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        console.log("tokens before: " + tokensBroker2Before.toString())

        const addpolicy2tx = await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, ethers.BigNumber.from('0'))
        await addpolicy2tx.wait()
        console.log("brokerwallet address: " + brokerWallet.address)

        await token.approve(bountyFromAdmin.address, ethers.utils.parseEther('1'))
        await bountyFromAdmin.sponsor(ethers.utils.parseEther('1'))

        const timeAtStart = Math.floor(Date.now() / 1000) + 10000
        const timestepSeconds = 1000
        const tokensPerSecond = 10

        await ethers.provider.send("evm_setNextBlockTimestamp", [timeAtStart])
        await ethers.provider.send('evm_mine', [0])

        // broker1 joins
        console.log("b1 alloc0 " + await bountyFromBroker.getAllocation(brokerWallet.address))
        console.log("b1 alloc0 " + await token.balanceOf(brokerWallet.address))
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, ethers.utils.parseEther('0.5'), "0x")).wait()
        // time advances
        await ethers.provider.send("evm_setNextBlockTimestamp", [timeAtStart + timestepSeconds + 1])
        await ethers.provider.send('evm_mine', [0])
        console.log("b1 alloc1 " + await bountyFromBroker.getAllocation(brokerWallet.address))
        console.log("b1 alloc1 " + await token.balanceOf(brokerWallet.address))
        // console.log("b2 alloc1 " + await bountyFromBroker2.getAllocation(broker2Wallet.address))

        // broker2 joins
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, ethers.utils.parseEther('0.5'), "0x")).wait()
        console.log("b1 alloc2 " + await bountyFromBroker.getAllocation(brokerWallet.address))
        console.log("b1 alloc2 " + await token.balanceOf(brokerWallet.address))
        // console.log("b2 alloc2 " + await bountyFromBroker2.getAllocation(broker2Wallet.address))
        // time advances
        await ethers.provider.send("evm_setNextBlockTimestamp", [timeAtStart + (3 * timestepSeconds) + 1])
        await ethers.provider.send('evm_mine', [0])
        console.log("b1 alloc3 " + await bountyFromBroker.getAllocation(brokerWallet.address))
        console.log("b1 alloc3 " + await token.balanceOf(brokerWallet.address))
        // console.log("b2 alloc3 " + await bountyFromBroker2.getAllocation(broker2Wallet.address))
        // broker2 leaves
        await (await bountyFromBroker2.leave()).wait()
        console.log("b1 alloc4 " + await bountyFromBroker.getAllocation(brokerWallet.address))
        console.log("b1 alloc4 " + await token.balanceOf(brokerWallet.address))
        // console.log("b2 alloc4 " + await bountyFromBroker2.getAllocation(broker2Wallet.address))
        // time advances
        await ethers.provider.send("evm_setNextBlockTimestamp", [timeAtStart + (4 * timestepSeconds) + 1])
        await ethers.provider.send('evm_mine', [0])
        console.log("b1 alloc5 " + await bountyFromBroker.getAllocation(brokerWallet.address))
        console.log("b1 alloc5 " + await token.balanceOf(brokerWallet.address))
        // broker1 leaves
        await (await bountyFromBroker.leave()).wait()
        console.log("b1 alloc6 " + await bountyFromBroker.getAllocation(brokerWallet.address))
        console.log("b1 alloc6 " + await token.balanceOf(brokerWallet.address))

        const tokensBroker1After = await token.balanceOf(brokerWallet.address)
        const tokensBroker2After = await token.balanceOf(broker2Wallet.address)

        expect(tokensBroker1After.sub(tokensBroker1Before).sub(((timestepSeconds * 3) + 1) * tokensPerSecond).eq(0)).to.be.true
        expect(tokensBroker2After.sub(tokensBroker2Before).sub((timestepSeconds) * tokensPerSecond).eq(0)).to.be.true
    })

    it('penalized leaving', async function(): Promise<void> {
        await (await tokenFromBroker.transfer(adminWallet.address, await token.balanceOf(brokerWallet.address))).wait()
        await (await token.transfer(brokerWallet.address, ethers.utils.parseEther('10'))).wait()
        const tokensBefore = await token.balanceOf(brokerWallet.address)

        await (await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, ethers.BigNumber.from('100000'))).wait()

        await token.approve(bountyFromAdmin.address, ethers.utils.parseEther('1'))
        await bountyFromAdmin.sponsor(ethers.utils.parseEther('1'))

        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, ethers.utils.parseEther('0.5'), "0x")).wait()

        await(await bountyFromBroker.leave()).wait()
        const tokensAfter = await token.balanceOf(brokerWallet.address)
        // broker lost 10% of his stake
        expect(tokensBefore.sub(ethers.utils.parseEther('0.05')).eq(tokensAfter)).to.be.true
    })

})
