#!/usr/bin/env bash
# 鎶?/push/* 鍔犺繘 Caddy锛堝箓绛夛細宸插瓨鍦ㄥ氨璺宠繃锛夛紝鐒跺悗鏍￠獙骞剁儹鍔犺浇
set -euo pipefail

CF=/etc/caddy/Caddyfile

if grep -q 'handle /push/\*' "$CF"; then
  echo "already present"
else
  cp "$CF" "$CF.bak.$(date +%s)"
  awk '
    /# ---- 闈欐€?PWA ----/ && !done {
      print "\t# ---- Web Push 鏈嶅姟 ----";
      print "\thandle /push/* {";
      print "\t\treverse_proxy 127.0.0.1:18789 {";
      print "\t\t\tflush_interval -1";
      print "\t\t\ttransport http {";
      print "\t\t\t\tread_timeout 30s";
      print "\t\t\t\twrite_timeout 30s";
      print "\t\t\t}";
      print "\t\t}";
      print "\t}";
      print "";
      done=1;
    }
    { print }
  ' "$CF.bak."* > /tmp/Caddyfile.new 2>/dev/null || true
  # 涓婇潰鐢ㄧ殑澶囦唤鏂囦欢鍙兘鍖归厤澶氫釜锛屾敼鐢ㄦ槑纭殑杈撳叆
  latest=$(ls -t /etc/caddy/Caddyfile.bak.* | head -1)
  awk '
    /# ---- 闈欐€?PWA ----/ && !done {
      print "\t# ---- Web Push 鏈嶅姟 ----";
      print "\thandle /push/* {";
      print "\t\treverse_proxy 127.0.0.1:18789 {";
      print "\t\t\tflush_interval -1";
      print "\t\t\ttransport http {";
      print "\t\t\t\tread_timeout 30s";
      print "\t\t\t\twrite_timeout 30s";
      print "\t\t\t}";
      print "\t\t}";
      print "\t}";
      print "";
      done=1;
    }
    { print }
  ' "$latest" > /tmp/Caddyfile.new

  if caddy validate --config /tmp/Caddyfile.new >/dev/null 2>&1; then
    cp /tmp/Caddyfile.new "$CF"
    echo "caddyfile updated"
  else
    echo "VALIDATION FAILED锛屼繚鎸佸師鏍?
    caddy validate --config /tmp/Caddyfile.new 2>&1 | tail -5
    exit 1
  fi
fi

systemctl reload caddy
sleep 1
echo "--- 鏈満甯?SNI 璁块棶 ---"
curl -s --resolve dsh.easymana.online:8443:127.0.0.1 https://dsh.easymana.online:8443/push/healthz -w " [%{http_code}]\n"
echo "--- 鍏挜鎺ュ彛 ---"
curl -s --resolve dsh.easymana.online:8443:127.0.0.1 https://dsh.easymana.online:8443/push/vapid -w " [%{http_code}]\n" | head -c 200
echo
