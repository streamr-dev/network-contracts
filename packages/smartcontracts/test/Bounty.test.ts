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
    let bountyCounter = 0
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

        const apF = await ethers.getContractFactory('StakeWeightedAllocationPolicy', adminWallet)
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

        const newBountyAddress = res.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        console.log("bounty " + newBountyAddress)

        const agreementFactory = await ethers.getContractFactory('Bounty')
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty
    })

    it('positivetest deploy bounty through factory, join', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))).wait()
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('1'))).wait()
        const tx = await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('2'), "0x")
        await tx.wait()
    })

    it('negativetest min stake join policy', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('1'), "0x")).to.be.revertedWith('error_minimum_stake')
    })

    it('negativetest max brokers join policy', async function(): Promise<void> {
        await(await bountyFromAdmin.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('0'))).wait()
        await expect(token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther('0'), "0x")).to.be.revertedWith('error_max_brokers')
    })
})
