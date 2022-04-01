
import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { Contract} from 'ethers'

const { provider } = waffle

use(waffle.solidity)
describe('DelegatedAccessRegistry', (): void => {

    const wallets = provider.getWallets()
    let contract: Contract
    before(async (): Promise<void> => {
        const DelegatedAccessRegistryFactory = await ethers.getContractFactory('DelegatedAccessRegistry', wallets[0])
        contract = await DelegatedAccessRegistryFactory.deploy()
    })

    it('should authorize a secondary wallet', async () => {
        const tx = await contract.authorize(wallets[1].address)
        expect(tx.confirmations).to.be.above(0)
    })

    it ('should verify that the authorized wallet has access', async () => {
        const authorized = await contract.isAuthorized(wallets[1].address)
        expect(authorized).to.be.true
    })

    it ('should verify that the authorized wallet has access via `isUserAuthorized` method', async () => {
        const authorized = await contract.isUserAuthorized(wallets[0].address, wallets[1].address)
        expect(authorized).to.be.true
    })

    it ('should revoke and verify the revocation', async () => {
        const tx = await contract.revoke(wallets[1].address)
        expect(tx.confirmations).to.be.above(0)
        const authorized = await contract.isAuthorized(wallets[1].address)
        expect(authorized).to.be.false
    })

})