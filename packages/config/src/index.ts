export const config = {
    "dev0": {
        "id": 8995,
        "name": "dev0",
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
            "OperatorDefaultPoolYieldPolicy": "0x252743660fACD52e7CEF851CEB1c133B58Fb526d"
        },
        "theGraphUrl": "http://10.200.10.1:8000/subgraphs/name/streamr-dev/network-subgraphs"
    },
    "dev2": {
        "id": 31337,
        "name": "dev2",
        "rpcEndpoints": [
            {
                "url": "http://10.200.10.1:8547"
            }
        ],
        "adminPrivateKey": "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0",
        "contracts": {
            "ENS": "0x5Aa81fB577a1765bb61E4841d958bDA75b5fa789",
            "FIFSRegistrar": "0x92958708A4E696A85C8282c946A89B20E4Ca308D",
            "PublicResolver": "0x916FE6b8DB2C0D01FB96F37550CE8ff41F4Ed470",
            "TrackerRegistry": "0xdc5F6368cd31330adC259386e78604a5E29E9415",
            "StorageNodeRegistry": "0x642D2B84A32A9A92FEc78CeAA9488388b3704898",
            "StreamRegistry": "0x231b810D98702782963472e1D60a25496999E75D",
            "ENSCacheV2": "0x6cCdd5d866ea766f6DF5965aA98DeCCD629ff222",
            "StreamStorageRegistry": "0xCcc2CD65bbF6B2f62cEc8116A4d36CE043f13352",
            "StreamrConfig": "0x3C841B9Aa08166e9B864972930703e878d25804B",
            "DATA": "0xAf71Ee871ff1a374F88D6Ff01Cd618cE85127e78",
            "SponsorshipMaxOperatorsJoinPolicy": "0xB9372284e0D61607aF3B7EF5f022e7D599Ed2a37",
            "SponsorshipStakeWeightedAllocationPolicy": "0x36368Be8Cde49558Ab6ceEf2632984b282Db8775",
            "SponsorshipDefaultLeavePolicy": "0xc24BA8c05E5206F1bE57bfA0aD14E9882126eD38",
            "SponsorshipVoteKickPolicy": "0xBFCF120a8fD17670536f1B27D9737B775b2FD4CF",
            "SponsorshipFactory": "0x57B81a9442805f88c4617B506206531e72d96290",
            "OperatorDefaultDelegationPolicy": "0xbfa4EcF9d107De5720446e6dd8162ef6bf4b3873",
            "OperatorDefaultPoolYieldPolicy": "0xF38aA4130AB07Ae1dF1d9F48386A16aD42768166",
            "OperatorDefaultUndelegationPolicy": "0x5159FBF2e0Ff63e35b17293416fdf7a0909a0cDA",
            "OperatorFactory": "0x122E9ee63Fa5e4F2710b7BB66E9a1FF0013Cec15",
            "ProjectRegistryV1": "0x7711fa72e78697c4B3b8bbBc8e9b91C662bC6253",
            "MarketplaceV4": "0xBaD604cd8C38E970b5285D34CA5d146268e2b84A",
            "ProjectStakingV1": "0x862FD06E0a3D5B651ED88e1C650E4f87ffD45018",
            "DataUnionFactory": "0xb8678223183d560280a7BEF68daAbB0E3daBd97D",
            "DataUnionTemplate": "0x4D563c20DB87a4EC4989607cD0Fdf4C95eD14d13"
        },
        "theGraphUrl": "http://10.200.10.1:8800/subgraphs/name/streamr-dev/network-subgraphs",
        "entryPoints": [
            {
                "id": "eeeeeeeeee",
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
        "name": "alfajores",
        "rpcEndpoints": [
            {
                "url": "https://alfajores-forno.celo-testnet.org"
            }
        ],
        "contracts": {
            "ProjectRegistryV1": "0x32A142A27A595DC75aD1443728fecCbD5650446A",
            "MarketplaceV4": "0x14577e0D5BD77536E073712d98E471edDaFAE8b4",
            "cUSD": "0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1"
        }
    },
    "optGoerli": {
        "id": 420,
        "name": "optGoerli",
        "rpcEndpoints": [
            {
                "url": "https://goerli.optimism.io"
            }
        ],
        "contracts": {
            "RemoteMarketplaceV1": "0xBef916b1EC6EAA3F522368f75094DAed5c228aF6",
            "DAI": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"
        }
    },
    "ethereum": {
        "id": 1,
        "name": "ethereum",
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
        }
    },
    "gnosis": {
        "id": 100,
        "name": "gnosis",
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
        }
    },
    "binance": {
        "id": 56,
        "name": "binance",
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
        }
    },
    "polygon": {
        "id": 137,
        "name": "polygon",
        "rpcEndpoints": [
            {
                "url": "https://polygon-rpc.com"
            },
            {
                "url": "https://poly-rpc.gateway.pokt.network/"
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
            "Marketplace": "0x058FbB3Cf628EE51CE8864C9Ee8350f81E495A7D",
            "MarketplaceV3": "0x1e9c22B4C92ce78Fe489C72f9D070C583D8359C3",
            "MarketplaceV4": "0xdF8b74D735197dCD5C94bE933db080E69A958de6",
            "ProjectRegistryV1": "0x496a6154da5aA6a021a3bd0DCd337DA80F48a6e1",
            "ProjectStakingV1": "0xAA7a4BdBE91F143F3103206e48A8AfF21101B6DE",
            "StorageNodeRegistry": "0x080F34fec2bc33928999Ea9e39ADc798bEF3E0d6",
            "StreamRegistry": "0x0D483E10612F327FC11965Fc82E90dC19b141641",
            "StreamStorageRegistry": "0xe8e2660CeDf2a59C917a5ED05B72df4146b58399",
            "Uniswap2Router": "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
            "UniswapAdapter": "0xAd54A57383EcA2D4f0D22337A96A7c4f6Bd51A13",
            "Uniswap2AdapterForMarketplaceV3": "0x83C42F77c6dD09A1A93A7834be65b3bB891106bE"
        }
    },
    "mumbai": {
        "id": 80001,
        "name": "mumbai",
        "rpcEndpoints": [
            {
                "url": "https://rpc-mumbai.maticvigil.com"
            }
        ],
        "contracts": {
            "ENS": "0x65A7AB0C8E0458cec9A74e343165678bb7Af14cC",
            "FIFSRegistrar": "0x51f3f98BD3499ED5c0310A81e7d169951B71ec66",
            "PublicResolver": "0xa5d4DBD2D0a28eDd76DDcddF2a36d960c468EFF7",
            "TrackerRegistry": "0xF9Ea78198E0307141c38e36422cF2A75b33FdAd4",
            "StorageNodeRegistry": "0x1bE4b2b970a9646373BAc8C859a7A327671d865B",
            "StreamRegistry": "0xdD6f4bcc2A450131775AdE05F1c7Ca12802D05D3",
            "ENSCacheV2": "0x1C46c8f30c6320C5463f98a1Ded04477F98B4fC6",
            "StreamStorageRegistry": "0x92e090e27067537e1974105ccc609Cf5A35f98F2",
            "StreamrConfig": "0xD4e8d4A1005B80746d907d57E0E6d24E725eC872",
            "DATA": "0x3c71F49bAbEd8105AbD454C606908577CF139A62",
            "SponsorshipMaxOperatorsJoinPolicy": "0xf879f2dd7e1F9a3e4323B87C22fDFE9d5B0578Af",
            "SponsorshipStakeWeightedAllocationPolicy": "0x4512F3FdE433397B8f09c04D17a8dad17aac803D",
            "SponsorshipDefaultLeavePolicy": "0xd9dd2232e8b8329987318a74aaf3cF5a236620e9",
            "SponsorshipVoteKickPolicy": "0x386BB7E960Fbf5101fedcedDa8608357788D0F24",
            "SponsorshipFactory": "0x13C288cD94733e0bE6fcfc2a0008913fec88aF8A",
            "OperatorDefaultDelegationPolicy": "0x88146e78CC12E3a8683D91De88CE3A31A94f6914",
            "OperatorDefaultPoolYieldPolicy": "0xaBe8B7D2164Bd30021FF838bb741f7566b4f441a",
            "OperatorDefaultUndelegationPolicy": "0x12E122a40D6948a94082d901d12512eFcf4525E1",
            "OperatorFactory": "0x30f3614d9c4A4f263696A4037CaaA3609710fCBB",
            "ProjectRegistryV1": "0x2F20D0C62179D0E3440De924515c3b2f608F67cD",
            "MarketplaceV4": "0xa8ec67fbe58b7c035Ae378A5e266f4AA1DaaB22E",
            "ProjectStakingV1": "0x03b2E964D011B5b9407494393175BDB89D3b3F47",
            "DataUnionFactory": "0xD2fB2dDc1186Fdb776E73402560F3A539171A8E4",
            "DataUnionTemplate": "0x0cBF56ec95b01E2EE54e1344dEaAaae15050Cb9B"
        },
        "theGraphUrl": "https://api.thegraph.com/subgraphs/name/samt1803/network-subgraphs",
        "entryPoints": [
            {
                "id": "e1",
                "websocket": {
                    "host": "entrypoint-1.streamr.network",
                    "port": 40401,
                    "tls": true
                }
            },
            {
                "id": "e2",
                "websocket": {
                    "host": "entrypoint-2.streamr.network",
                    "port": 40401,
                    "tls": true
                }
            }
        ]
    }
}
