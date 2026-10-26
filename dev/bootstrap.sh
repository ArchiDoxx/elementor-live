#!/usr/bin/env bash
# Richtet die Dev-Instanz ein: WordPress installieren, Elementor aktivieren, Testseite anlegen.
# Aufruf (aus WSL):  bash dev/bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")"

SITE_URL="${ELIVE_DEV_URL:-http://localhost:8080}"
ADMIN_USER="${ELIVE_DEV_USER:-admin}"
ADMIN_PASS="${ELIVE_DEV_PASS:-admin}"

docker compose up -d
echo "warte auf WordPress ..."
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null "$SITE_URL/wp-admin/install.php"; then break; fi
  sleep 2
done

wp() { docker compose exec -T cli wp "$@"; }

if ! wp core is-installed >/dev/null 2>&1; then
  wp core install --url="$SITE_URL" --title="Elementor Live Dev" \
    --admin_user="$ADMIN_USER" --admin_password="$ADMIN_PASS" \
    --admin_email="dev@example.test" --skip-email
fi

wp option update permalink_structure '/%postname%/'
wp rewrite flush --hard >/dev/null 2>&1 || true

if ! wp plugin is-installed elementor >/dev/null 2>&1; then
  wp plugin install elementor
fi
wp plugin activate elementor >/dev/null
wp theme install hello-elementor --activate >/dev/null 2>&1 || true

# Elementor: Onboarding/Hinweise stumm schalten, Container-Feature sicherstellen
wp option update elementor_onboarded 1 >/dev/null
wp option update elementor_experiment-container active >/dev/null 2>&1 || true
wp option update elementor_disable_color_schemes yes >/dev/null 2>&1 || true
wp option update elementor_disable_typography_schemes yes >/dev/null 2>&1 || true

# Testseite „Playground" anlegen (einmalig) und für Elementor freischalten
PAGE_ID=$(wp post list --post_type=page --name=playground --field=ID | head -1 || true)
if [ -z "$PAGE_ID" ]; then
  PAGE_ID=$(wp post create --post_type=page --post_status=publish --post_title="Playground" --post_name=playground --porcelain)
  wp post meta update "$PAGE_ID" _elementor_edit_mode builder >/dev/null
  wp post meta update "$PAGE_ID" _elementor_template_type wp-page >/dev/null
  wp post meta update "$PAGE_ID" _wp_page_template elementor_canvas >/dev/null
fi

echo
echo "Dev-Instanz bereit:"
echo "  Admin:   $SITE_URL/wp-admin  ($ADMIN_USER / $ADMIN_PASS)"
echo "  Editor:  $SITE_URL/wp-admin/post.php?post=$PAGE_ID&action=elementor"
echo "  Elementor: $(wp plugin get elementor --field=version)"
