# Demo UI mockups

These HTML files render **fictional** DockTerm UI for marketing screenshots
(`docs/assets/shot-*.jpg`). They do not use data from any real machine.

Regenerate:

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1320,860 \
  --screenshot=../assets/shot-hosts.png file://$PWD/hosts.html
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1320,860 \
  --screenshot=../assets/shot-session.png file://$PWD/session.html
sips -s format jpeg -s formatOptions 85 ../assets/shot-hosts.png --out ../assets/shot-hosts.jpg
sips -s format jpeg -s formatOptions 85 ../assets/shot-session.png --out ../assets/shot-session.jpg
rm ../assets/shot-hosts.png ../assets/shot-session.png
```
