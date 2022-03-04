import prod db dump into local mysql
mysql -u root -ppassword -h 127.0.0.1 -P 3306 core_test < streamr_prod.2021-11-10__12_05.sql

export data into tsv file
echo "select id, name from stream;" | mysql -u root -ppassword -h 127.0.0.1 -P 3306 core_test | grep -v "^id" > myformat.tsv



hat:core:hre Creating provider for network polygonMainnet
"0x04e15239c37d0a74a5fcd84133b5913afb121102/streamr/node/metrics/day",
"0x0cd2f8eba5033524ac7e2d9d72c112ac4383d576/VANTECH",
"0x1039bc4d681a0868d4ae7a9770b142bc525e6895/thisisnew",
"0x15b0958917d945288f181924818067e4dfce238d/streamr/node/metrics/day",
"0x15b0958917d945288f181924818067e4dfce238d/streamr/node/metrics/hour",
"0x15b0958917d945288f181924818067e4dfce238d/streamr/node/metrics/min",
"0x15b0958917d945288f181924818067e4dfce238d/streamr/node/metrics/sec",
"0x5b1569bef32f58491272b478ddd0f7e4efdf35d7/meteroloji1",
"0x7d275b79eaed6b00eb1fe7e1174c1c6f2e711283/testastorage",
"0x98bebbe4218fcaa44fe5dfc0bc3b3244cf2a6c10/TestStream",
"0xab138905776f5aa8113c174b73601152fd3207bc/siggi.eth",
"0xc939c2e8f856ca4a0b9ec7c031662c926d6ba50f/Airometri"