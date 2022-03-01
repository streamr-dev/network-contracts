import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
// import { BigNumber, utils, Wallet } from 'ethers'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { StreamAgreement } from '../typechain/StreamAgreement'

// const { deployContract } = waffle
const { provider } = waffle

// eslint-disable-next-line no-unused-vars

use(waffle.solidity)

describe('Agreements', (): void => {
    const wallets = provider.getWallets()
    let bountyFactory: BountyFactory

    before(async (): Promise<void> => {
        const bountyFactoryFactory = await ethers.getContractFactory('BountyFactory', wallets[0])
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory, [ wallets[9].address ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
    })

    it.only('deploy agreement', async (): Promise<void> => {
        const agreement = await bountyFactory.deployBountyAgreement()
        await agreement.wait()
        expect(agreement).to.be.not.null
        console.log(JSON.stringify(agreement))
    })

})
