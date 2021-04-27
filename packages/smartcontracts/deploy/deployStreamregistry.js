// module.exports = async ({ getNamedAccounts, deployments }) => {
//     const { deploy } = deployments
//     const { deployer } = await getNamedAccounts()
//     await deploy('StreamRegistry', {
//         from: deployer,
//         args: ['0x2fb7Cd141026fcF23Abb07593A14D6E45dC33D54'],
//         log: true,
//     })
// }
// module.exports.tags = ['StreamRegistry']

module.exports = async ({ getNamedAccounts,
    deployments,
    getChainId,
    getUnnamedAccounts, }) => {
    const { deploy } = deployments
    const { deployer } = await getNamedAccounts()

    // the following will only deploy "GenericMetaTxProcessor"
    // if the contract was never deployed or if the code changed since last deployment
    await deploy('StreamRegistry', {
        from: deployer,
        gasLimit: 4000000,
        args: ['0x2fb7Cd141026fcF23Abb07593A14D6E45dC33D54']
    })
}
