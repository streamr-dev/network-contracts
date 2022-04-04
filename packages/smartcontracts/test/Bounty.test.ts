// SPDX-License-Identifier: MIT

import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
// import { BigNumber, utils, Wallet } from 'ethers'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { Bounty } from '../typechain/Bounty'
import { Contract, ContractFactory } from 'ethers'
import { ERC677 } from '../typechain/ERC677'
import { IAllocationPolicy, IJoinPolicy, ILeavePolicy } from '../typechain'

// const { deployContract } = waffle
const { provider } = waffle

// eslint-disable-next-line no-unused-vars

use(waffle.solidity)

// testcases to not forget:
// - increase stake if already joined

describe('Bounty', (): void => {
    const wallets = provider.getWallets()
    const adminAddress = wallets[0].address
    const brokerAddress = wallets[8].address
    const trustedForwarderAddress: string = wallets[9].address
    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let bounty: Bounty
    let tokenAddress: string
    let token: ERC677
    let minStakeJoinPolicy: IJoinPolicy
    let maxBrokersJoinPolicy: IJoinPolicy
    let leavePolicy: ILeavePolicy
    let allocationPolicy: IAllocationPolicy

    before(async (): Promise<void> => {
        const tokenTxr = await ethers.getContractFactory('LinkToken', wallets[0])
        token = await tokenTxr.deploy() as ERC677
        tokenAddress = token.address
        // await token.mint(adminAddress, ethers.utils.parseEther('1000000'))

        const jpMS = await ethers.getContractFactory('MinimumStakeJoinPolicy', wallets[0])
        const jpMSC = await jpMS.deploy() as Contract
        minStakeJoinPolicy = await jpMSC.connect(wallets[0]).deployed() as IJoinPolicy

        const jpMaxB = await ethers.getContractFactory('MaxAmountBrokersJoinPolicy', wallets[0])
        const jpMaxBTx = await jpMaxB.deploy() as Contract
        maxBrokersJoinPolicy = await jpMaxBTx.connect(wallets[0]).deployed() as IJoinPolicy

        // const lpF = await ethers.getContractFactory('DefaultLeavePolicy', wallets[0])
        // const lpTx = await lpF.deploy() as Contract
        // leavePolicy = await lpTx.connect(wallets[0]).deployed() as ILeavePolicy

        const apF = await ethers.getContractFactory('WeightBasedAllocationPolicy', wallets[0])
        const apTx = await apF.deploy() as Contract
        allocationPolicy = await apTx.connect(wallets[0]).deployed() as IAllocationPolicy

        const agreementFactory = await ethers.getContractFactory('Bounty')
        const agreementTemplate = await agreementFactory.deploy()
        await agreementTemplate.deployed()

        bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', wallets[0])
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory, 
            [ agreementTemplate.address, trustedForwarderAddress, tokenAddress ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
    })

    it('positivetest deploy bounty through factory, join', async function(): Promise<void> {
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, this.test?.fullTitle()!)
        const res = await agreementtx.wait()

        const newBountyAddress = res.events?.filter(e => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        const agreementFactory = await ethers.getContractFactory('Bounty')
        bounty = new Contract(newBountyAddress, agreementFactory.interface, wallets[0]) as Bounty
        // console.log(await bounty.unallocatedWei())

        const addpolicytx = await bounty.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))
        const addpolicyres = await addpolicytx.wait()
        const addpolicy2tx = await bounty.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('1'))
        const addpolicy2res = await addpolicy2tx.wait()

        let tx = await token.transferAndCall(bounty.address, ethers.utils.parseEther('2'), "0x")
        await tx.wait()
    })

    it('negativetest min stake join policy', async function(): Promise<void> {
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, this.test?.fullTitle()!)
        const res = await agreementtx.wait()

        const newBountyAddress = res.events?.filter(e => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        const agreementFactory = await ethers.getContractFactory('Bounty')
        bounty = new Contract(newBountyAddress, agreementFactory.interface, wallets[0]) as Bounty
        const addpolicytx = await bounty.addJoinPolicy(minStakeJoinPolicy.address, ethers.BigNumber.from('2000000000000000000'))
        const addpolicyres = await addpolicytx.wait()

        await expect(token.transferAndCall(bounty.address, ethers.utils.parseEther('1'), "0x")).to.be.revertedWith('error_minimum_stake')
    })
    
    it('negativetest max brokers join policy', async function(): Promise<void> {
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, this.test?.fullTitle()!)
        const res = await agreementtx.wait()

        const newBountyAddress = res.events?.filter(e => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        const agreementFactory = await ethers.getContractFactory('Bounty')
        bounty = new Contract(newBountyAddress, agreementFactory.interface, wallets[0]) as Bounty

        const addpolicy2tx = await bounty.addJoinPolicy(maxBrokersJoinPolicy.address, ethers.BigNumber.from('0'))
        const addpolicy2res = await addpolicy2tx.wait()
        await expect(token.transferAndCall(bounty.address, ethers.utils.parseEther('0'), "0x")).to.be.revertedWith('error_max_brokers')
    })

    it('positivetest weightbased allocationpolicy', async function(): Promise<void> {
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, this.test?.fullTitle()!)
        const res = await agreementtx.wait()

        const newBountyAddress = res.events?.filter(e => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        const agreementFactory = await ethers.getContractFactory('Bounty')
        bounty = new Contract(newBountyAddress, agreementFactory.interface, wallets[0]) as Bounty

        // await token.approve(bounty.address, ethers.utils.parseEther('1'))

        const addpolicy2tx = await bounty.setAllocationPolicy(allocationPolicy.address, ethers.BigNumber.from('0'))
        const addpolicy2res = await addpolicy2tx.wait()
        await token.transferAndCall(bounty.address, ethers.utils.parseEther('0'), "0x")

        await token.approve(bounty.address, ethers.utils.parseEther('1'))
        await bounty.sponsor(ethers.utils.parseEther('1'))

        console.log((await bounty.getUnallocatedWei()).toString());
        
    })
})
