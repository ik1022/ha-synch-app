import json, pathlib, secrets, socket, subprocess, sys, tempfile, time, urllib.request

def docker(*args):
    return subprocess.check_output(['docker',*args],text=True).strip()

def main():
    image=sys.argv[1] if len(sys.argv)>1 else 'synch-ha:0.1.0-test'
    name='synch-smoke-'+secrets.token_hex(6)
    volume=name+'-data'; restored=name+'-restored'
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); port=s.getsockname()[1]
    url=f'http://127.0.0.1:{port}'
    def create(vol):
        docker('create','--name',name,'--init','--mount',f'type=volume,src={vol},dst=/data','-p',f'127.0.0.1:{port}:8787',image)
        docker('cp',str(pathlib.Path(__file__).with_name('client.mjs')),name+':/tmp/ha-client.mjs')
    def ready():
        for _ in range(90):
            try:
                with urllib.request.urlopen(url+'/health',timeout=2) as r:
                    if r.status==200: return
            except OSError: pass
            if docker('inspect','-f','{{.State.Running}}',name)!='true': raise RuntimeError('Container exited')
            time.sleep(1)
        raise RuntimeError('Startup timeout')
    def stop():
        docker('stop','--time','55',name)
        assert docker('inspect','-f','{{.State.ExitCode}}',name)=='0'
    docker('volume','create',volume)
    try:
        create(volume)
        with tempfile.TemporaryDirectory() as directory:
            options=pathlib.Path(directory)/'options.json'
            options.write_text(json.dumps({'public_url':url,'allowed_emails':['test@example.com'],'request_timeout_ms':300000}))
            docker('cp',str(options),name+':/data/options.json')
        docker('start',name); ready()
        for page in ('/signin','/signup','/vaults'):
            with urllib.request.urlopen(url+page,timeout=5) as r:
                assert r.status==200 and 'text/html' in r.headers['Content-Type']
        print(docker('exec',name,'node','/tmp/ha-client.mjs','create'))
        original=docker('exec',name,'cat','/data/synch-secrets.json')
        stop(); docker('start',name); ready()
        assert docker('exec',name,'cat','/data/synch-secrets.json')==original
        print(docker('exec',name,'node','/tmp/ha-client.mjs','verify'))
        stop(); docker('volume','create',restored)
        docker('run','--rm','--entrypoint','sh','--mount',f'type=volume,src={volume},dst=/source,readonly','--mount',f'type=volume,src={restored},dst=/target',image,'-c','cp -a /source/. /target/')
        docker('rm',name); create(restored); docker('start',name); ready()
        print(docker('exec',name,'node','/tmp/ha-client.mjs','verify'))
        stop()
        print('PASS: web UI, signup allowlist, two-client protocol, disk persistence, restart, cold-copy restore')
    except Exception:
        log=subprocess.run(['docker','logs','--tail','60',name],text=True,capture_output=True)
        print(log.stdout+log.stderr,file=sys.stderr)
        raise
    finally:
        subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for v in (volume,restored): subprocess.run(['docker','volume','rm',v],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

if __name__=='__main__':main()
