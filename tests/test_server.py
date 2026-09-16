import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch
from io import BytesIO
from app import make_handler, TrajectoryStore, ThreadingHTTPServer
from catalog import CatalogService, number, separation, query_catalog

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.store=TrajectoryStore(Path(cls.tmp.name)/'path.json')
        class FakeCatalog:
            def get(self,ra,dec,*rest):
                return {'objects':[], 'ra':number(ra,'ra',0,360), 'dec':number(dec,'dec',-90,90)}
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(FakeCatalog(),cls.store))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.tmp.cleanup()
    def request(self,path,method='GET',body=None,headers=None):
        c=HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        c.request(method,path,body=body,headers=headers or {})
        r=c.getresponse();result=(r.status,r.read(),dict(r.getheaders()));c.close();return result
    def test_frontend(self):
        status,body,_=self.request('/');self.assertEqual(status,200);self.assertIn(b'EPHEMERIS',body)
        self.assertEqual(self.request('/app.js')[0],200)
    def test_private_files_not_served(self):
        for p in ['/Reference/CNS3_ARICNS.txt','/../app.py','/%2e%2e/app.py','/.local/trajectory.json']:self.assertEqual(self.request(p)[0],404)
    def test_health(self):self.assertEqual(json.loads(self.request('/api/health')[1])['version'],'0.1.0')
    def test_bad_catalogue_parameters(self):self.assertEqual(self.request('/api/catalog?ra=NaN')[0],400)
    def test_trajectory_roundtrip(self):
        self.request('/api/trajectory','DELETE')
        r=self.request('/api/trajectory','POST',json.dumps({'ra':360,'dec':-0.1}),{'Content-Type':'application/json'})
        self.assertEqual(r[0],200);self.assertEqual(json.loads(r[1]),[{'ra':0,'dec':-.1}])
        again=TrajectoryStore(self.store.path);self.assertEqual(again.points,[{'ra':0,'dec':-.1}])
    def test_invalid_points(self):
        for p in [{'ra':1,'dec':91},{'ra':'NaN','dec':0},[],{'ra':True,'dec':0}]:self.assertEqual(self.request('/api/trajectory','POST',json.dumps(p),{'Content-Type':'application/json'})[0],400)
    def test_cross_origin_write_blocked(self):self.assertEqual(self.request('/api/trajectory','DELETE',headers={'Origin':'https://example.com'})[0],403)
    def test_non_json_write_blocked(self):self.assertEqual(self.request('/api/trajectory','POST','x')[0],415)

class CatalogueTests(unittest.TestCase):
    def test_numeric_validation(self):
        for n in ['nan','inf',True,None,361]:
            with self.assertRaises(ValueError):number(n,'ra',0,360)
        self.assertEqual(number('1.2','ra',0,360),1.2)
    def test_ra_wrap(self):self.assertAlmostEqual(separation(359,0,1,0),2)
    def test_parse_live_response_and_query(self):
        payload={'metadata':[{'name':k} for k in ['main_id','ra','dec','otype','sp_type','mag_v','mag_b']], 'data':[['test',1,2,'Star','A0V',3,3.1],['unknown',2,3,'Neb',None,None,None]]}
        with patch('catalog.urlopen',return_value=BytesIO(json.dumps(payload).encode())) as url:
            result=query_catalog(1,2)
        self.assertAlmostEqual(result['objects'][0]['bv'],.1);self.assertIsNone(result['objects'][1]['mag_v'])
        self.assertIn('ORDER BY mag_v ASC',result['query']);self.assertEqual(url.call_count,1)
    def test_seed_fallback_is_geographically_filtered(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'seed.json';p.write_text(json.dumps({'objects':[{'id':'near','ra':1,'dec':0,'mag_v':3},{'id':'far','ra':180,'dec':0,'mag_v':3}]}))
            with patch('catalog.query_catalog',side_effect=OSError('offline')):
                result=CatalogService(p).get(0,0,5)
            self.assertTrue(result['fallback']);self.assertEqual([x['id'] for x in result['objects']],['near'])
    def test_cache_avoids_repeated_service_requests(self):
        service=CatalogService(Path('not-needed'))
        with patch('catalog.query_catalog',return_value={'objects':[]}) as query:
            service.get(0,0);r=service.get(0,0)
        self.assertEqual(query.call_count,1);self.assertTrue(r['cached'])

if __name__=='__main__':unittest.main()
