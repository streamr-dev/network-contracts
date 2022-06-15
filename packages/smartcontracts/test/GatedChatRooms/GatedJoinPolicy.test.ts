
import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { Contract} from 'ethers'
import EthCrypto from 'eth-crypto'

const { provider } = waffle

use(waffle.solidity)
describe('GatedJoinPolicy', (): void => {
    enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

    const wallets = provider.getWallets()
    let contract: Contract

    let signerIdentity: any 
    let message: string 
    let signature: string
    before(async (): Promise<void> => {
        signerIdentity = EthCrypto.createIdentity();
        message = EthCrypto.hash.keccak256(wallets[0].address);
        signature = EthCrypto.sign(signerIdentity.privateKey, message)

        const GatedJoinPolicy = await ethers.getContractFactory('GatedJoinPolicy', wallets[0])
        
        contract = await GatedJoinPolicy.deploy(
            '0x0000000000000000000000000000000000000000',
            'stream_id',
            [PermissionType.Subscribe, PermissionType.Publish]
        )
    })

    it ('should exercise the splitSignature method', async() => {
        const [v, r, s] = await contract.splitSignature(signature)
        expect(v.toString().length).to.equal(2)
        expect(r.length).to.equal(66)
        expect(s.length).to.equal(66)
    })

    it ('should exercise the recoverSigner method', async () => {
        const signer = await contract.recoverSigner(
            message,
            signature
        )
        expect(signer).to.equal(signerIdentity.address)
    } )
})