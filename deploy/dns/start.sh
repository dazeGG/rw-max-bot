#!/bin/sh
# DNS-сервер только для проверки сертификата админки: Let's Encrypt читает здесь TXT-запись,
# которую на время выпуска создает Caddy. Постоянных данных нет, зона собирается при каждом запуске.

set -eu

dir=/var/lib/acme-dns
zone="_acme-challenge.${ADMIN_DOMAIN}."

rm -rf "$dir"
mkdir -p "$dir"

cat > "$dir/zone" <<EOF
\$ORIGIN $zone
\$TTL 60
@ SOA ${DOMAIN}. hostmaster.${DOMAIN}. 1 3600 600 86400 60
@ NS ${DOMAIN}.
EOF

cat > "$dir/knot.conf" <<EOF
server:
  listen: 0.0.0.0@53

log:
  - target: stdout
    any: info

key:
  - id: acme
    algorithm: hmac-sha256
    secret: ${ACME_TSIG_SECRET}

acl:
  # Менять можно только TXT, только из docker-сети и только с ключом
  - id: caddy-update
    address: [172.16.0.0/12, 192.168.0.0/16]
    key: acme
    action: update
    update-type: [TXT]

template:
  - id: default
    storage: $dir

zone:
  - domain: $zone
    file: zone
    acl: caddy-update
EOF

exec knotd --config "$dir/knot.conf"
