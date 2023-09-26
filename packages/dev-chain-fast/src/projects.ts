export const projects = [
    {
        "id": "0x0000000000000000000000000000000000000000000000000000000000000001",
        "minimumSubscriptionSeconds": 0,
        "chainIds": [31337],
        "paymentDetails": [
            {
                "beneficiary": "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1",
                "pricingTokenAddress": "0xAf71Ee871ff1a374F88D6Ff01Cd618cE85127e78",
                "pricePerSecond": 0
            }
        ],
        "streams": [],
        "isPublicPurchable": true,
        "metadata": "{\"isDataUnion\": true, \"name\": \"Test Project 1\", \"description\": \"payable with TestToken\"}"
    },
    {
        "id": "0x0000000000000000000000000000000000000000000000000000000000000002",
        "minimumSubscriptionSeconds": 1,
        "chainIds": [31337],
        "paymentDetails": [
            {
                "beneficiary": "0xAf71Ee871ff1a374F88D6Ff01Cd618cE85127e78",
                "pricingTokenAddress": "0x3387F44140ea19100232873a5aAf9E46608c791E",
                "pricePerSecond": 2
            }
        ],
        "streams": [],
        "isPublicPurchable": true,
        "metadata": "{\"isDataUnion\": false}, \"name\": \"Test Project 2\", \"description\": \"payable with DATA\"}"
    },
    {
        "id": "0x0000000000000000000000000000000000000000000000000000000000000003",
        "minimumSubscriptionSeconds": 21,
        "chainIds": [31337],
        "paymentDetails": [
            {
                "beneficiary": "0xAf71Ee871ff1a374F88D6Ff01Cd618cE85127e78",
                "pricingTokenAddress": "0x3387F44140ea19100232873a5aAf9E46608c791E",
                "pricePerSecond": 183643
            }
        ],
        "streams": [],
        "isPublicPurchable": true,
        "metadata": "{\"name\": \"Test Project 3\", \"description\": \"payable with DATA\"}"
    },
    {
        "id": "0x0000000000000000000000000000000000000000000000000000000000000004",
        "minimumSubscriptionSeconds": 1000,
        "chainIds": [31337],
        "paymentDetails": [
            {
                "beneficiary": "0xAf71Ee871ff1a374F88D6Ff01Cd618cE85127e78",
                "pricingTokenAddress": "0x3387F44140ea19100232873a5aAf9E46608c791E",
                "pricePerSecond": 521900
            }
        ],
        "streams": [],
        "isPublicPurchable": true,
        "metadata": "string metadata | payable with DATA"
    },
    {
        "id": "0x0000000000000000000000000000000000000000000000000000000000000005",
        "minimumSubscriptionSeconds": 1000000000,
        "chainIds": [31337],
        "paymentDetails": [
            {
                "beneficiary": "0xAf71Ee871ff1a374F88D6Ff01Cd618cE85127e78",
                "pricingTokenAddress": "0x3387F44140ea19100232873a5aAf9E46608c791E",
                "pricePerSecond": "1000000000000000000"
            }
        ],
        "streams": [],
        "isPublicPurchable": false,
        "metadata": "{\"name\": \"Test Project 5\", \"description\": \"payable with DATA\"}"
    }
]
