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
    let minStakeJoinPolicy: IJoinPolicy
    let maxBrokersJoinPolicy: IJoinPolicy
    let bountyCounter = 0
    let bountyFromAdmin: Contract
    let bountyFromBroker: Contract

    before(async (): Promise<void> => {
        const tokenTxr = await ethers.getContractFactory('LinkToken', adminWallet)
        token = await tokenTxr.deploy() as IERC677
        tokenAddress = token.address

        const jpMS = await ethers.getContractFactory('MinimumStakeJoinPolicy', adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        minStakeJoinPolicy = await jpMSC.connect(adminWallet).deployed() as IJoinPolicy

        const jpMaxB = await ethers.getContractFactory('MaxAmountBrokersJoinPolicy', adminWallet)
        const jpMaxBTx = await jpMaxB.deploy() as Contract
        maxBrokersJoinPolicy = await jpMaxBTx.connect(adminWallet).deployed() as IJoinPolicy

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

        const newBountyAddress = res.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        console.log("bounty " + newBountyAddress)

        const agreementFactory = await ethers.getContractFactory('Bounty')
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty
    })

    it('positivetest deploy bounty through factory, join bounty', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))).wait()
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('1'))).wait()
        const tx = await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('2'), "0x")
        await tx.wait()
    })

    it('negativetest addjoinpolicy from not-admin', async function(): Promise<void> {
        await expect(bountyFromBroker.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000')))
            .to.be.revertedWith('error_mustBeAdminRole')
    })

    it('negativetest trying to join with wrong token', async function(): Promise<void> {
        const newtokenTxr = await ethers.getContractFactory('LinkToken', adminWallet)
        const newToken = await newtokenTxr.deploy() as IERC677
        const newTokenFromAdmin = newToken.connect(adminWallet)
        // await expect(newTokenFromBroker.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x"))
        //     .to.be.revertedWith('error_onlyTokenContract')
        await expect(newTokenFromAdmin.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x"))
            .to.be.revertedWith('error_onlyTokenContract')
    })

    // this should actually fail, but there might be a hardhat bug that allows calling functions on non-existing contracts, so we skip it for now
    // it('negativetest setjoinpolicy pointing to nonexistant contract', async function(): Promise<void> {
    //     await expect(bountyFromAdmin.addJoinPolicy(wallets[4].address, ethers.BigNumber.from('2000000000000000000')))
    //         .to.be.revertedWith('error adding join policy')
    // })

    it('negativetest sponsor with no allowance', async function(): Promise<void> {
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther('1'))).to.be.reverted
    })

    it('negativetest min stake join policy', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x")).to.be.revertedWith('error_minimum_stake')
    })

    it('negativetest max brokers join policy', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('0'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('0'), "0x")).to.be.revertedWith('error_max_brokers')
    })

    it('negativetest sponsor with no allowance', async function(): Promise<void> {
        await expect(bountyFromAdmin.sponsor(ethers.utils.parseEther('1'))).to.be.revertedWith('')
    })

    it('negativetest error setting param on joinpolicy', async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory('TestJoinPolicy', adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testJoinPolicy = await jpMSC.connect(adminWallet).deployed() as IJoinPolicy
        await expect(bountyFromAdmin.addJoinPolicy(testJoinPolicy.address, ethers.BigNumber.from('1'))) // it will throw with 1
            .to.be.revertedWith('test-error: setting param join policy')
    })

    it('negativetest error joining on joinpolicy', async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory('TestJoinPolicy', adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testJoinPolicy = await jpMSC.connect(adminWallet).deployed() as IJoinPolicy
        await (await bountyFromAdmin.addJoinPolicy(testJoinPolicy.address, ethers.BigNumber.from('2'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('0'), "0x"))
            .to.be.revertedWith('test-error: checkAbleToJoin join policy')
    })

    it('negativetest error setting param on allocationPolicy', async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory('TestAllocationPolicy', adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await expect(bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, ethers.BigNumber.from('1'))) // it will thrown with 1
            .to.be.revertedWith('test-error: setting param allocation policy')
    })

    it('negativetest error onJoin on allocationPolicy', async function(): Promise<void> {
        const jpMS = await ethers.getContractFactory('TestAllocationPolicy', adminWallet)
        const jpMSC = await jpMS.deploy() as Contract
        const testAllocPolicy = await jpMSC.connect(adminWallet).deployed() as IAllocationPolicy
        await (await bountyFromAdmin.setAllocationPolicy(testAllocPolicy.address, ethers.BigNumber.from('2'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x"))
            .to.be.revertedWith('test-error: onjoin allocation policy')
    })

    it('negativetest calling fallback function', async function(): Promise<void> {
        await expect(adminWallet.sendTransaction({to: bountyFromAdmin.address})).to.be.revertedWith('error_mustBeThis')
    })
})