#!/usr/bin/env python3
import requests
import time
import subprocess
import base64

OLD_PDS = "https://cannect.space"
NEW_PDS = "https://pds.cannect.space"
OLD_ADMIN_PASSWORD = "05ae258b5462447d5b98e23d8db4ac0c"
NEW_PASSWORD = "MigratedUser2026!"

USERS = [
    ("vermontijuana", "eli@yourgreenbridge.com"),
    ("greenmountainsativ", "greenmountainsativa@gmail.com"),
    ("stonerjesus", "canjaconstruction@gmail.com"),
    ("dankprank7", "luiso-26@hotmail.com"),
    ("crownedhemp", "jeremy.crownedhemp@gmail.com"),
    ("theweedboss2", "bfwservices@gmail.com"),
    ("blakebrown", "blakeabrownll@gmail.com"),
    ("cannabis_corner", "harleybhiggins@hotmail.com"),
    ("dabble420", "dabble.420.vt@gmail.com"),
    ("organnicsliving", "james@organnicsliving.com"),
    ("bakedpotato", "drewmakesthings@gmail.com"),
    ("drewmakesthings", "drewmakesthings@gmail.com"),
    ("boofandtheganj", "boofandthegangshow@gmail.com"),
    ("cannabisguruvt", "vermontcultureco@gmail.com"),
    ("heady_harvest", "headyharvestvt@gmail.com"),
    ("2kana", "hello@two-cana.com"),
]

def get_token(did):
    q = f"SELECT token FROM email_token WHERE did='{did}' AND purpose='plc_operation' ORDER BY requestedAt DESC LIMIT 1"
    r = subprocess.run(["sqlite3", "/pds/account.sqlite", q], capture_output=True, text=True)
    return r.stdout.strip()

auth = base64.b64encode(("admin:" + OLD_ADMIN_PASSWORD).encode()).decode()
success = []
failed = []

for handle, email in USERS:
    old_h = handle + ".cannect.space"
    new_h = handle + ".pds.cannect.space"
    print(f"\n{'='*50}")
    print(f"Migrating: {handle}")
    print(f"Email: {email}")
    
    try:
        # Step 0: Resolve handle to DID
        print("Step 0: Resolve DID...")
        r = requests.get(OLD_PDS + "/xrpc/com.atproto.identity.resolveHandle", 
            params={"handle": old_h})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        did = r.json()["did"]
        print(f"  DID: {did}")
        
        # Step 1: Reset password
        print("Step 1: Reset password...")
        r = requests.post(OLD_PDS + "/xrpc/com.atproto.admin.updateAccountPassword", 
            headers={"Authorization": "Basic " + auth, "Content-Type": "application/json"}, 
            json={"did": did, "password": NEW_PASSWORD})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        print("  OK")
        
        # Step 2: Login
        print("Step 2: Login...")
        r = requests.post(OLD_PDS + "/xrpc/com.atproto.server.createSession", 
            json={"identifier": old_h, "password": NEW_PASSWORD})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        s = r.json()
        old_t = s["accessJwt"]
        print("  OK")
        
        # Step 3: Service auth
        print("Step 3: Service auth...")
        r = requests.get(OLD_PDS + "/xrpc/com.atproto.server.getServiceAuth", 
            headers={"Authorization": "Bearer " + old_t}, 
            params={"aud": "did:web:pds.cannect.space", "lxm": "com.atproto.server.createAccount"})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        svc_t = r.json()["token"]
        print("  OK")
        
        # Step 4: Export repo
        print("Step 4: Export repo...")
        r = requests.get(OLD_PDS + "/xrpc/com.atproto.sync.getRepo", params={"did": did})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        repo = r.content
        print(f"  Size: {len(repo)} bytes")
        
        # Step 5: Create account on new PDS
        print("Step 5: Create account...")
        r = requests.post(NEW_PDS + "/xrpc/com.atproto.server.createInviteCode", 
            headers={"Authorization": "Basic " + auth}, json={"useCount": 1})
        inv = r.json()["code"]
        
        r = requests.post(NEW_PDS + "/xrpc/com.atproto.server.createAccount", 
            headers={"Authorization": "Bearer " + svc_t}, 
            json={"handle": new_h, "email": email, "password": NEW_PASSWORD, "did": did, "inviteCode": inv})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        new_t = r.json()["accessJwt"]
        print("  OK (deactivated)")
        
        # Step 6: Import repo
        print("Step 6: Import repo...")
        r = requests.post(NEW_PDS + "/xrpc/com.atproto.repo.importRepo", 
            headers={"Authorization": "Bearer " + new_t, "Content-Type": "application/vnd.ipld.car"}, 
            data=repo)
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        print("  OK")
        
        # Step 7: Get credentials
        print("Step 7: Get credentials...")
        r = requests.get(NEW_PDS + "/xrpc/com.atproto.identity.getRecommendedDidCredentials", 
            headers={"Authorization": "Bearer " + new_t})
        c = r.json()
        rot_k = c["rotationKeys"][0]
        ver_m = c["verificationMethods"]["atproto"]
        print(f"  Rotation key: {rot_k[:40]}...")
        
        # Step 8: Request PLC signature
        print("Step 8: Request PLC signature...")
        requests.post(OLD_PDS + "/xrpc/com.atproto.identity.requestPlcOperationSignature", 
            headers={"Authorization": "Bearer " + old_t})
        time.sleep(0.5)
        print("  OK")
        
        # Step 9: Get token
        print("Step 9: Get token from DB...")
        tok = get_token(did)
        if not tok: 
            print("  ERROR: No token found")
            failed.append(handle)
            continue
        print(f"  Token: {tok}")
        
        # Step 10: Sign PLC
        print("Step 10: Sign PLC operation...")
        r = requests.post(OLD_PDS + "/xrpc/com.atproto.identity.signPlcOperation", 
            headers={"Authorization": "Bearer " + old_t}, 
            json={
                "token": tok, 
                "rotationKeys": [rot_k], 
                "verificationMethods": {"atproto": ver_m}, 
                "alsoKnownAs": ["at://" + new_h], 
                "services": {"atproto_pds": {"type": "AtprotoPersonalDataServer", "endpoint": NEW_PDS}}
            })
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        op = r.json()["operation"]
        print("  OK")
        
        # Step 11: Submit PLC
        print("Step 11: Submit PLC operation...")
        r = requests.post(NEW_PDS + "/xrpc/com.atproto.identity.submitPlcOperation", 
            headers={"Authorization": "Bearer " + new_t}, 
            json={"operation": op})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        print("  OK")
        
        # Step 12: Activate
        print("Step 12: Activate account...")
        r = requests.post(NEW_PDS + "/xrpc/com.atproto.server.activateAccount", 
            headers={"Authorization": "Bearer " + new_t})
        if r.status_code != 200: 
            print(f"  ERROR: {r.text}")
            failed.append(handle)
            continue
        print("  OK")
        
        print(f"\n✅ SUCCESS: {new_h}")
        success.append(handle)
        time.sleep(1)
        
    except Exception as e:
        print(f"EXCEPTION: {e}")
        failed.append(handle)

print(f"\n{'='*50}")
print(f"MIGRATION COMPLETE: {len(success)}/{len(USERS)}")
print(f"{'='*50}")
print("\nSuccessful:")
for h in success:
    print(f"  ✅ {h}.pds.cannect.space")
if failed:
    print("\nFailed:")
    for h in failed:
        print(f"  ❌ {h}")
