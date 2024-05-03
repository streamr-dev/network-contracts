export const config = {
    "dev0": {
        "id": 8995,
        "name": "dev0",
        "nativeCurrency": {
            "symbol": "DEV",
            "name": "Developer Ethereum",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "http://10.200.10.1:8545"
            },
            {
                "url": "ws://10.200.10.1:8545"
            }
        ],
        "contracts": {
            "AMB": "0xaFA0dc5Ad21796C9106a36D68f69aAD69994BB64",
            "DATA": "0xbAA81A0179015bE47Ad439566374F2Bae098686F",
            "DataUnionFactory": "0x90a0480c6fA6b2dC967d8F03660c81C8a5A7c465",
            "DataUnionTemplate": "0x07a4CaF6064ACFe4c279e32e5ed2F376B36DcB3F",
            "DefaultFeeOracle": "0x454E0fEcCf4611eA9E41C986E4A2949CFD4b53d4",
            "ENS": "0x92E8435EB56fD01BF4C79B66d47AC1A94338BB03",
            "FIFSRegistrar": "0x57B81a9442805f88c4617B506206531e72d96290",
            "Marketplace": "0xF1371c0f40528406dc4f4cAf89924eA9Da49E866",
            "MarketplaceV3": "0x56e57Bf7422eDe1ED75520D4387829feEe8a8319",
            "MigrationManager": "0xc7aaf6c62e86a36395d8108fe95d5f758794c16c",
            "PublicResolver": "0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c",
            "TokenMediator": "0xedD2aa644a6843F2e5133Fe3d6BD3F4080d97D9F",
            "TrackerRegistry": "0xBFCF120a8fD17670536f1B27D9737B775b2FD4CF",
            "Uniswap2Router": "0xeE1bC9a7BFF1fFD913f4c97B6177D47E804E1920",
            "UniswapAdapter": "0xE4eA76e830a659282368cA2e7E4d18C4AE52D8B3",
            "Uniswap2AdapterForMarketplaceV3": "0xDbcdfB708A006A9AebC592C4520289cD87a95938",
            "XDATA": "0x6d0F3bF9aD2455b4F62f22fFD21317e1E3eEFE5C",
            "core-api": "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c"
        }
    },
    "dev1": {
        "id": 8997,
        "name": "dev1",
        "nativeCurrency": {
            "symbol": "DEV",
            "name": "Developer Ethereum",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "http://10.200.10.1:8546"
            },
            {
                "url": "ws://10.200.10.1:8546"
            }
        ],
        "contracts": {
            "AMB": "0xaFA0dc5Ad21796C9106a36D68f69aAD69994BB64",
            "DATA": "0x73Be21733CC5D08e1a14Ea9a399fb27DB3BEf8fF",
            "DataUnionFactory": "0x50aAa135AeBAC61E8394F80fF2Df091fcb66b072",
            "DefaultFeeOracle": "0xd1FA6C06E1D838Bb989640A2C4b8a499FD0ab187",
            "DataUnionTemplate": "0xC2F87E37019e227F2Be5030aabBCc7eAF136e05c",
            "LINK": "0x3387F44140ea19100232873a5aAf9E46608c791E",
            "Marketplace": "0xa072C42CB167d68D4c1cA15d0e4d0bd93E74A80f",
            "MarketplaceV3": "0xA90CeCcA042312b8f2e8B924C04Ce62516CBF7b2",
            "MarketplaceV4": "0xB9372284e0D61607aF3B7EF5f022e7D599Ed2a37",
            "ProjectRegistryV1": "0x3C841B9Aa08166e9B864972930703e878d25804B",
            "ProjectStakingV1": "0xBFCF120a8fD17670536f1B27D9737B775b2FD4CF",
            "Mediator": "0xedD2aa644a6843F2e5133Fe3d6BD3F4080d97D9F",
            "StorageNodeRegistry": "0x231b810D98702782963472e1D60a25496999E75D",
            "StreamRegistry": "0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222",
            "ENSCacheV2": "0x611900fD07BB133016Ed85553aF9586771da5ff9",
            "StreamStorageRegistry": "0xd04af489677001444280366Dd0885B03dAaDe71D",
            "Uniswap2Router": "0xdc5F6368cd31330adC259386e78604a5E29E9415",
            "StreamrConfig": "0xa86863053cECFD9f6f861e0Fd39a042238411b75",
            "SponsorshipFactory": "0x58C8e321d561123649bE41445cB0690Ec3d27Fe9",
            "SponsorshipDefaultLeavePolicy": "0xa2338F8be0941B361baBebb01ab8da5725CF0a33",
            "SponsorshipMaxOperatorsJoinPolicy": "0x2521E0480004056c35e199a1BBE2FdA9119032A0",
            "SponsorshipOperatorContractOnlyJoinPolicy": "0xd8F0a63e5EB661695620c92af5d981D18d5a484E",
            "SponsorshipStakeWeightedAllocationPolicy": "0xef927F18D2ac3862c6ABCAa953203A4DbF7f519e",
            "SponsorshipVoteKickPolicy": "0x0617466e5bC15027c604A56E35b172E06d689E4f",
            "OperatorFactory": "0xcb5bCb343218044C547AFdcBa2e50Ac728D0DcA3",
            "OperatorDefaultDelegationPolicy": "0x03CF38C75BFb9F4466fBA0aEd95f2613B0D1bCA0",
            "OperatorDefaultUndelegationPolicy": "0x67A0E9C9c21d11dB4eBAe420aBf705626a3a2561",
            "OperatorDefaultExchangeRatePolicy": "0x252743660fACD52e7CEF851CEB1c133B58Fb526d"
        },
        "theGraphUrl": "http://10.200.10.1:8000/subgraphs/name/streamr-dev/network-subgraphs"
    },
    "dev2": {
        "id": 31337,
        "name": "dev2",
        "nativeCurrency": {
            "symbol": "DEV",
            "name": "Developer Ethereum",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "http://10.200.10.1:8547"
            }
        ],
        "adminPrivateKey": "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
        "contracts": {
            "DATA": "0xbAA81A0179015bE47Ad439566374F2Bae098686F",
            "ENS": "0x642D2B84A32A9A92FEc78CeAA9488388b3704898",
            "FIFSRegistrar": "0x338090C5492C5c5E41a4458f5FC4b205cbc54A24",
            "PublicResolver": "0x18E0937099660B82464475Ea2B7e6Af4f2BFE5F0",
            "TrackerRegistry": "0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222",
            "StorageNodeRegistry": "0xCBAcfA0592B3D809aEc805d527f8ceAe9307D9C0",
            "StreamRegistry": "0xd04af489677001444280366Dd0885B03dAaDe71D",
            "ENSCacheV2": "0xB73189CeBCc870bE6f9aa16764bbB3665e4B49B6",
            "StreamStorageRegistry": "0xB9372284e0D61607aF3B7EF5f022e7D599Ed2a37",
            "StreamrConfig": "0xc24BA8c05E5206F1bE57bfA0aD14E9882126eD38",
            "SponsorshipOperatorContractOnlyJoinPolicy": "0x57B81a9442805f88c4617B506206531e72d96290",
            "SponsorshipMaxOperatorsJoinPolicy": "0x699B4bE95614f017Bb622e427d3232837Cc814E6",
            "SponsorshipStakeWeightedAllocationPolicy": "0xBc0c81a318D57ae54dA28DE69184A9c3aE9a1e1c",
            "SponsorshipDefaultLeavePolicy": "0x611900fD07BB133016Ed85553aF9586771da5ff9",
            "SponsorshipVoteKickPolicy": "0x256D4CB67452b6b8280B2b67F040fD22f1C378f4",
            "SponsorshipFactory": "0xbfa4EcF9d107De5720446e6dd8162ef6bf4b3873",
            "OperatorDefaultDelegationPolicy": "0xeE1bC9a7BFF1fFD913f4c97B6177D47E804E1920",
            "OperatorDefaultExchangeRatePolicy": "0xD13D34d37e2c94cb35EA8D5DE7498Cb7830d26e0",
            "OperatorDefaultUndelegationPolicy": "0x1Cc93b7f91727e7c9bC86025C622A664e93DFb29",
            "OperatorFactory": "0x3AE0ad89b0e094fD09428589849C161f0F7f4E6A",
            "ProjectRegistryV1": "0x73a9310C43621B853C508902bb8c1DA8f1240EaE",
            "MarketplaceV4": "0x9472993E43dea67bB82B46Cc71Ef9570f83A8049",
            "ProjectStakingV1": "0x2e426B42bfc5512fFACa7Dd8a3Bd89f05dCe2eBE",
            "DataUnionFactory": "0xdc5F6368cd31330adC259386e78604a5E29E9415",
            "DataUnionTemplate": "0xEAA002f7Dc60178B6103f8617Be45a9D3df659B6"
        },
        "theGraphUrl": "http://10.200.10.1:8800/subgraphs/name/streamr-dev/network-subgraphs",
        "entryPoints": [
            {
                "nodeId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                "websocket": {
                    "host": "10.200.10.1",
                    "port": 40500,
                    "tls": false
                }
            }
        ]
    },
    "alfajores": {
        "id": 44787,
        "name": "Celo Alfajores",
        "nativeCurrency": {
            "symbol": "CELO",
            "name": "Celo Alfajores",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "https://alfajores-forno.celo-testnet.org"
            }
        ],
        "contracts": {
            "ProjectRegistryV1": "0x32A142A27A595DC75aD1443728fecCbD5650446A",
            "MarketplaceV4": "0x14577e0D5BD77536E073712d98E471edDaFAE8b4",
            "cUSD": "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1"
        },
        "blockExplorerUrl": "https://alfajores.celoscan.io"
    },
    "optGoerli": {
        "id": 420,
        "name": "Optimism Goerli Testnet",
        "nativeCurrency": {
            "symbol": "ETH",
            "name": "Optimism Goerli Testnet Ethereum",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "https://goerli.optimism.io"
            }
        ],
        "contracts": {
            "RemoteMarketplaceV1": "0xBef916b1EC6EAA3F522368f75094DAed5c228aF6",
            "DAI": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"
        },
        "blockExplorerUrl": "https://goerli-optimism.etherscan.io"
    },
    "ethereum": {
        "id": 1,
        "name": "Ethereum",
        "nativeCurrency": {
            "symbol": "ETH",
            "name": "Ethereum",
            "decimals": 18
        },
        "rpcEndpoints": [],
        "contracts": {
            "AMB": "0x4C36d2919e407f0Cc2Ee3c993ccF8ac26d9CE64e",
            "DATA": "0x8f693ca8D21b157107184d29D398A8D082b38b76",
            "ENS": "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
            "Marketplace": "0xdc8d23092b93f9bb7416f45dea36f55996f34867",
            "MediatorDATA": "0x29e572d45cC33D5a68DCc8f92bfc7ded0017Bc59",
            "MediatorXDATA": "0x2eeeDdeECe91c9F4c5bA4C8E1d784A0234C6d015",
            "MigrationManager": "0xf32219E61c840300D1B35c939ed9E54a86163334",
            "TrackerRegistry": "0xab9BEb0e8B106078c953CcAB4D6bF9142BeF854d",
            "UniswapAdapter": "0xbe99db4ea1964ea9a9e80de41517901da6ef9307",
            "XDATA": "0x0cf0ee63788a0849fe5297f3407f701e122cc023",
            "core-api": "0xf3E5A65851C3779f468c9EcB32E6f25D9D68601a"
        },
        "blockExplorerUrl": "https://etherscan.io"
    },
    "gnosis": {
        "id": 100,
        "name": "Gnosis Chain",
        "nativeCurrency": {
            "symbol": "xDAI",
            "name": "xDai",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "https://rpc.gnosischain.com"
            },
            {
                "url": "wss://rpc.gnosischain.com/wss"
            }
        ],
        "contracts": {
            "AMB": "0x75Df5AF045d91108662D8080fD1FEFAd6aA0bb59",
            "BinanceAdapterDATA": "0x193888692673b5dD46e6BC90bA8cBFeDa515c8C1",
            "BinanceAdapterXDATA": "0x0c1aF6edA561fbDA48E9A7B1Dd46D216F31A97cC",
            "DATA": "0x256eb8a51f382650B2A1e946b8811953640ee47D",
            "DataUnionFactory": "0xe4515702878931b45Dfe4D89d3Fb3208910C913C",
            "DataUnionTemplate": "0x1d425525c7A5df3736875fe76Bc3B9E776E89AcA",
            "DataUnionFeeOracle": "0x86686266E7cA80b247151104f26d308079997637",
            "Marketplace": "0x246dd6D96282c1ED9Ca69eF9f3e1f975fC1B8Bd5",
            "MarketplaceV3": "0x2022E1F7749D355726Fb65285E29605A098bcb52",
            "MediatorDATA": "0x53f3F44c434494da73EC44a6E8a8D091332bC2ce",
            "MediatorXDATA": "0x7d55f9981d4E10A193314E001b96f72FCc901e40",
            "MigrationManager": "0x29e572d45cC33D5a68DCc8f92bfc7ded0017Bc59",
            "RemoteMarketplaceV1": "0x023eaE17d3dd65F1e7b4daa355e6478719Bd2BEf",
            "StorageNodeRegistry": "0xC746847d7916623fb75849696f04827bbc34854f",
            "UniswapAdapter": "0xc5Cd4900841a849d798725441b54fB0fec0d0f5b",
            "Uniswap2AdapterForMarketplaceV3": "0xec92c5f94d45D1a4D917f2E07dD959b33e1AFe38",
            "XDATA": "0xE4a2620edE1058D61BEe5F45F6414314fdf10548"
        },
        "blockExplorerUrl": "https://gnosisscan.io"
    },
    "binance": {
        "id": 56,
        "name": "BNB Chain",
        "nativeCurrency":{
            "symbol": "BNB",
            "name": "BNB",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "https://bsc-dataseed.binance.org"
            },
            {
                "url": "wss://bsc-dataseed.binance.org"
            }
        ],
        "contracts": {
            "DATA": "0x0864c156b3c5f69824564dec60c629ae6401bf2a",
            "xdaiBridge": "0xa93ee7b4a7215f7e725437a6b6d7a4e7fe1dd8f0"
        },
        "blockExplorerUrl": "https://bscscan.com"
    },
    "polygon": {
        "id": 137,
        "name": "Polygon",
        "nativeCurrency": {
            "symbol": "MATIC",
            "name": "MATIC",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "https://polygon-rpc.com"
            },
            {
                "url": "https://polygon.gateway.tenderly.co"
            }
        ],
        "contracts": {
            "ChainlinkOracle": "0x36BF71D0ba2e449fc14f9C4cF51468948E4ED27D",
            "DATA": "0x3a9A81d576d83FF21f26f325066054540720fC34",
            "DataUnionFactory": "0xd0B3a09A6bCee8446d10e6E7e12c78F8725C9B18",
            "DataUnionTemplate": "0xaFe97F5a1cD3edE2c11d990e0EB0270054AA0589",
            "DataUnionFeeOracle": "0x369Be397b3Cfe914728Bbd2329c0e5D1FE2E4202",
            "GSNPayMaster": "0x43E69adABC664617EB9C5E19413a335e9cd4A243",
            "GSNForwarder": "0xdA78a11FD57aF7be2eDD804840eA7f4c2A38801d",
            "ENSCache": "0xEd9d3D29c25e197677DD84E3f7D81cCCD613B2bF",
            "ENSCacheV2": "0xEd9d3D29c25e197677DD84E3f7D81cCCD613B2bF",
            "Marketplace": "0x058FbB3Cf628EE51CE8864C9Ee8350f81E495A7D",
            "MarketplaceV3": "0x1e9c22B4C92ce78Fe489C72f9D070C583D8359C3",
            "MarketplaceV4": "0xdF8b74D735197dCD5C94bE933db080E69A958de6",
            "ProjectRegistryV1": "0x496a6154da5aA6a021a3bd0DCd337DA80F48a6e1",
            "ProjectStakingV1": "0xAA7a4BdBE91F143F3103206e48A8AfF21101B6DE",
            "StorageNodeRegistry": "0x080F34fec2bc33928999Ea9e39ADc798bEF3E0d6",
            "StreamRegistry": "0x0D483E10612F327FC11965Fc82E90dC19b141641",
            "StreamStorageRegistry": "0xe8e2660CeDf2a59C917a5ED05B72df4146b58399",
            "StreamrConfig": "0x869e88dB146ECAF20dDf199a12684cD80c263c8f",
            "SponsorshipOperatorContractOnlyJoinPolicy": "0xa1F3c94A682Cb43d26AcC40dA1Dc31f49e4dA466",
            "SponsorshipMaxOperatorsJoinPolicy": "0x27448061420bAccAE8c84DDC3E7e2e8B2aE4977E",
            "SponsorshipStakeWeightedAllocationPolicy": "0x1Dd16E748308E9f259f3D6097d00e1793BfBdcDB",
            "SponsorshipDefaultLeavePolicy": "0xa953D590098A3d56304a12A8e929D63748D90AAC",
            "SponsorshipVoteKickPolicy": "0xeF3F567D7328849c1130CBCBF8Cd9feB42eA5dB5",
            "SponsorshipFactory": "0x820b2f9a15ed45F9802c59d0CC77C22C81755e45",
            "OperatorDefaultDelegationPolicy": "0x8e449F0B1AFAD807135B5Ea829F41851d5DE1426",
            "OperatorDefaultExchangeRatePolicy": "0xE8F511bB4888D16D81acab7ab1c05A356E37237f",
            "OperatorDefaultUndelegationPolicy": "0x5c81fA1e79318386Dd82Ef059bCB194DbA87De45",
            "OperatorFactory": "0x935734e66729b69260543Cf6e5EfeB42AC962183",
            "Uniswap2Router": "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
            "UniswapAdapter": "0xAd54A57383EcA2D4f0D22337A96A7c4f6Bd51A13",
            "Uniswap2AdapterForMarketplaceV3": "0x83C42F77c6dD09A1A93A7834be65b3bB891106bE"
        },
        "blockExplorerUrl": "https://polygonscan.com",
        // eslint-disable-next-line max-len
        "theGraphUrl": "https://gateway-arbitrum.network.thegraph.com/api/a971cec07440a9ec63cd806c06ccc990/subgraphs/id/EGWFdhhiWypDuz22Uy7b3F69E9MEkyfU9iAQMttkH5Rj",
        "entryPoints": [
            {
                "nodeId": "e5f87a7ee99b3c91e7b795b70f87ef8ba5497596",
                "websocket": {
                    "host": "polygon-entrypoint-3.streamr.network",
                    "port": 40402,
                    "tls": true
                }
            },
            {
                "nodeId": "6f5b53812fd9cc07f225a0b3a6aa5b96672e852e",
                "websocket": {
                    "host": "polygon-entrypoint-4.streamr.network",
                    "port": 40402,
                    "tls": true
                }
            }
        ]
    },
    "mumbai": {
        "id": 80001,
        "name": "Polygon Mumbai",
        "nativeCurrency": {
            "symbol": "MATIC",
            "name": "Mumbai MATIC",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "https://gateway.tenderly.co/public/polygon-mumbai"
            },
            {
                "url": "https://rpc.ankr.com/polygon_mumbai"
            }
        ],
        "contracts": {
            "DATA": "0x53d8268307c6EE131AafDe5E6FD3575bADbB3D20",
            "ENS": "0x0fEC601fD12fBB544f5fDCc489fb0641B2178954",
            "FIFSRegistrar": "0x9f7251cc9A04Cb0dA4107Ea979ECBe5112A0fE69",
            "PublicResolver": "0x3d381a2B2c588C891BD4986b52255336a267df3e",
            "TrackerRegistry": "0x72BEAbAaBf4a46d5b525B3b46D3D2F9FacC93f2B",
            "StorageNodeRegistry": "0xE6D449A7Ef200C0e50418c56F84079B9fe625199",
            "StreamRegistry": "0x4F0779292bd0aB33B9EBC1DBE8e0868f3940E3F2",
            "ENSCacheV2": "0x5eeb458843D4dE852f295ED8cb01BAd3b464bB67",
            "StreamStorageRegistry": "0xA5a2298c9b48C08DaBF5D76727620d898FD2BEc1",
            "StreamrConfig": "0x4D3F744BC5614986c10aF8Bf36B15372c72252D7",
            "SponsorshipMaxOperatorsJoinPolicy": "0xFCa3ec6c20EeA8E60A631700a42A8B14dA8408D8",
            "SponsorshipStakeWeightedAllocationPolicy": "0x500046908D2C478f71D8788A20d7f9A5c71b892c",
            "SponsorshipDefaultLeavePolicy": "0x002f203d68BB30b00C72D65f7Ad468f138315b11",
            "SponsorshipVoteKickPolicy": "0x7A948aa53f763810bF4aF8610c5A16CDf433206f",
            "SponsorshipFactory": "0x9a842c37575f84A076036F2531134ba0a94a69C6",
            "OperatorDefaultDelegationPolicy": "0xF96E1D4773651850b295cD93DFCc9E769F873749",
            "OperatorDefaultExchangeRatePolicy": "0x1F3dA55fBAd65A417Bc7150C6A3ad3d6308E2Cef",
            "OperatorDefaultUndelegationPolicy": "0x93fDAAEE4D29E04DE4A8C7d8aA8E003AdBe39b91",
            "OperatorFactory": "0xb843fC3cB92c31AAa8d9e0379F7c5c204Faa82cA",
            "ProjectRegistryV1": "0x35062aAda71A3dd6Dc3470866d418033113c3e40",
            "MarketplaceV4": "0x4629ceBEA69F67D04e97f77C3F47E6E8E14114d5",
            "ProjectStakingV1": "0x8E94F3c9453a6d2aEE0ac154eb4Bf8D6517393D0",
            "DataUnionFactory": "0xc7e4042f801A86538c48761bEfCb05b846ab756C",
            "DataUnionTemplate": "0x8d3dc2a15283C0af16895aD27253B9e1A777E789"
        },
        "theGraphUrl": "https://api.thegraph.com/subgraphs/name/streamr-dev/network",
        "blockExplorerUrl": "https://mumbai.polygonscan.com",
        "entryPoints": [
            {
                "nodeId": "d48787fc36eaed43770ec84947ef81557b19ec98",
                "websocket": {
                    "host": "mumbai-entrypoint-1.streamr.network",
                    "port": 40402,
                    "tls": true
                }
            },
            {
                "nodeId": "24395826687b099fd735a730219ba750169c4f40",
                "websocket": {
                    "host": "mumbai-entrypoint-2.streamr.network",
                    "port": 40402,
                    "tls": true
                }
            }
        ]
    },
    "polygonAmoy": {
        "id": 80002,
        "name": "Polygon Amoy testnet",
        "nativeCurrency": {
            "symbol": "MATIC",
            "name": "Amoy MATIC",
            "decimals": 18
        },
        "rpcEndpoints": [
            {
                "url": "https://polygon-amoy-bor-rpc.publicnode.com"
            },
            {
                "url": "https://rpc-amoy.polygon.technology"
            }
        ],
        "contracts": {
            "DATA": "0xf5e28a2E7BbedbE97c3782b17b102410E10d90f1",
            "StreamRegistry": "0xE9C98bdE63248e58E9137Db8270D9675B9E34b93",
            "ENSCacheV2": "0x6a81414936868fdcF4f077e2a0B24879e2871016",
            "StorageNodeRegistry": "0x02fdF917f4e6Ae8F7F1bBDd28179d819E2b76820",
            "StreamStorageRegistry": "0x0f3671A9A92416E1aD32750faCf2AD4FA1b66f78",
            "StreamrConfig": "0x835bC97D2a61bbF5d05932C5105Ca34e1b815F94",
            "SponsorshipOperatorContractOnlyJoinPolicy": "0x930Dcc2ca313ACf7177185C0D68462fDc699C7e0",
            "SponsorshipMaxOperatorsJoinPolicy": "0xd640C2C5102953d122759826daa6Aec25eC98ca5",
            "SponsorshipStakeWeightedAllocationPolicy": "0xaC80c738FCF8d259F07C82eAD68B75aF4DF82223",
            "SponsorshipDefaultLeavePolicy": "0x16Ba0F2793Da54b67717c6bAD471624C6628F2aa",
            "SponsorshipVoteKickPolicy": "0xf9Aad3bf4F6D682b9c04Ee3812B88B379b238d13",
            "SponsorshipFactory": "0xb194a68b166f2e3074B551393fA61490D19c69f8",
            "OperatorDefaultDelegationPolicy": "0x78f29fF290148e83795393f1858DC540D8cB046b",
            "OperatorDefaultExchangeRatePolicy": "0x48d25dd5731AD644613b67E4281C505Ef392Dd70",
            "OperatorDefaultUndelegationPolicy": "0x7962155D5ea2fF949FCF300F221964d5ef9d1bad",
            "OperatorFactory": "0xE02E8E9fF5ea6a58F34D00C0e4B091e066B9fA81",
            "ProjectRegistryV1": "0xc5e1434d35c0c7291c7032Fd9C4096b4876C6823",
            "ProjectStakingV1": "0x3A27A16770477EbcFb4B81cE462F4f12591767A0",
            "MarketplaceV4": "0x6C8eaA8e0bF605469c15b6F9106387B4cEC99976",
        },
        "theGraphUrl": "https://api.studio.thegraph.com/query/58729/streamr-amoy-testnet/v1.0.0",
        "blockExplorerUrl": "https://amoy.polygonscan.com",
        "entryPoints": [
            {
                "nodeId": "d48787fc36eaed43770ec84947ef81557b19ec98",
                "websocket": {
                    "host": "amoy-entrypoint-1.streamr.network",
                    "port": 40402,
                    "tls": true
                }
            },
            {
                "nodeId": "24395826687b099fd735a730219ba750169c4f40",
                "websocket": {
                    "host": "amoy-entrypoint-2.streamr.network",
                    "port": 40402,
                    "tls": true
                }
            }
        ]
    }
}
