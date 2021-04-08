import { ethers } from 'ethers'
const provider = new ethers.providers.InfuraProvider('rinkeby', 'f39345d630524f63af651ecb5c94f1d6')

const main = async () => {
  const res = await provider.resolveName('cspengineering.eth')
  console.log(res)
}
main()
