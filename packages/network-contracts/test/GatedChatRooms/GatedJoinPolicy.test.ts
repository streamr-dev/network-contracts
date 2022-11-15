import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { Contract} from 'ethers'

const { provider } = waffle

use(waffle.solidity)
describe('GatedJoinPolicy', (): void => {
    enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

    const wallets = provider.getWallets()
    let contract: Contract

    before(async (): Promise<void> => {

        const GatedJoinPolicy = await ethers.getContractFactory('GatedJoinPolicy', wallets[0])
        
        contract = await GatedJoinPolicy.deploy(
            '0x0000000000000000000000000000000000000000',
            '0x0000000000000000000000000000000000000000',
            'stream_id',
            [PermissionType.Subscribe, PermissionType.Publish]
        )
    })

    it ('should verify the contract got deployed', async() => {
        expect(contract.address).to.not.equal(undefined)
    })
})