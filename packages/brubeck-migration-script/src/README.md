import prod db dump into local mysql
mysql -u root -ppassword -h 127.0.0.1 -P 3306 core_test < streamr_prod.2021-11-10__12_05.sql

export data into tsv file
echo "select id, name from stream;" | mysql -u root -ppassword -h 127.0.0.1 -P 3306 core_test | grep -v "^id" > myformat.tsv

