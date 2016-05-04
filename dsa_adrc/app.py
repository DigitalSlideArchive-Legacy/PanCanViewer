from flask import Flask, request, redirect, url_for, send_from_directory,jsonify,make_response
from werkzeug.wsgi import DispatcherMiddleware

from bson.json_util import dumps
from flask_crossdomains import crossdomain
import gridfs
import random, os

import logging
from collections import OrderedDict
from flask import Flask, abort, make_response, render_template, url_for
from io import BytesIO
import openslide
from openslide import OpenSlide, OpenSlideError
from openslide.deepzoom import DeepZoomGenerator
from optparse import OptionParser
from threading import Lock

log = logging.getLogger('werkzeug')
from flask.ext.cache import Cache

#http://stackoverflow.com/questions/18281433/flask-handling-a-pdf-as-its-own-page
pancan_config = {}

import pymongo
client = pymongo.MongoClient('localhost',27017)
slide_db_ptr = client['PanCanDSA_Slide_Data']
load_errors_db = client['PanCan_LoadErrors']

###Features Database
dbf = client['PanCan_BoundsOnly']

app = Flask('dsa_adrc')

# Check Configuring Flask-Cache section for more details
cache = Cache(app,config={'CACHE_TYPE': 'memcached'})
dsa_slide_db = client['PanCanDSA_Slide_Data']
app.config['SLIDE_DIR'] = '/home/lcoop22/Images'   ### DO NOT PUT A TRAILING / after this

SLIDE_DIR = '.'
SLIDE_CACHE_SIZE = 100
DEEPZOOM_FORMAT = 'jpeg'
DEEPZOOM_TILE_SIZE = 256
DEEPZOOM_OVERLAP = 1
DEEPZOOM_LIMIT_BOUNDS = True
DEEPZOOM_TILE_QUALITY = 75

#application = DispatcherMiddleware( { '/backend': backend })
@app.route('/')
def root():
    return app.send_static_file('index.html')

## adding decorators to allow cross origin access
@app.route('/api/v1/collections')
@crossdomain(origin='*')
def get_collections():
    coll_list = dsa_slide_db['PanCanDSA_Slide_Data'].distinct('slideGroup')
    return jsonify( { 'Collections': sorted(coll_list) })

@app.route('/api/v1/collections/slides/<string:coll_name>')
@crossdomain(origin='*')
def get_slides( coll_name):
    """This will return the list of slides for a given collection aka tumor type """
    return dumps( {'slide_list': dsa_slide_db['PanCanDSA_Slide_Data'].find({'slideGroup': coll_name }) })

##This will process and store files that were marked as bad...
@app.route('/api/v1/report_bad_image', methods=["POST"])
def report_bad_images():
    filename=request.form['filename']
    slide_url = request.form['slide_url']
    data_group = request.form['data_group']
    load_errors_db['cdsa_live'].insert({ 'filename':filename, 'slide_url':slide_url, 'data_group':data_group})
    return 'OK'

@app.route('/db/getdatasets.php')
def mnv_getDatesets():
    """This is a holding spot for Mike's get data sets routine which routes an array of arrays"""
    print "HI DAVE!!"
    ds = []
    coll_list = dsa_slide_db['PanCanDSA_Slide_Data'].distinct('slideGroup')
    for c in coll_list:
        ds.append( [c,c] )
    return dumps(  ds )



@app.route('/db/getslides.php', methods=["POST","GET"])
def mnv_getSlides():
    """This is a holding spot for Mike's get slide list"""
    try:
        dataset = request.form['dataset']
    except:
        dataset = "SARC"
    slideSet = dsa_slide_db['PanCanDSA_Slide_Data'].find({'slideGroup': dataset})

    slides = []
    paths = [] 
    for ss in slideSet:
        slides.append( ss['slide_name'].split(".")[0] )  ## I don't want to display the UID part of the SVS file
        paths.append( ss['slide_w_path'])

    return dumps( { 'slides': slides, 'paths': paths })


@app.route('/db/getnuclei.php', methods=["POST"])
def getVisibleBoundaries():
    left   = request.form['left']    
    right  = request.form['right']
    top    = request.form['top']     
    bottom = request.form['bottom'] 
    slide  = request.form['slide']    
    uid = request.form['uid']
    
    scaleFactor = 2
    trainSet = 'Not USED'
    print left,right,top,bottom,slide
    
    #slide = 'TCGA-DX-AB2V-01Z-00-DX3'
    coll_name = "Features.V1.SARC.%s" % slide
    
    c1 =  "%d,%d %d,%d %d,%d %d,%d"
    

    scaleFactor = 0.5
    #scale factor is related to this being a 20X segmentation on a 40X slide
    left = float(left) * scaleFactor
    right = float(right) * scaleFactor
    top = float(top)   * scaleFactor
    bottom = float(bottom)  * scaleFactor


    ### Need to add in scale factor

    boundaryObject=  []
    #coll_name = 'Features.V1.SARC.TCGA-DX-A7EI-01A-01-TSA' ### Hard code this for now
    seg_obj_crsr = dbf[coll_name].find( { 'X': {"$gt": left, "$lt": right},
                                      'Y': {"$gt": top,  "$lt": bottom }
                                    })
                                   
    nucleiAvail = seg_obj_crsr.count()
    if nucleiAvail < 10000:
        for n in seg_obj_crsr:
            obj_bounds = n['Boundaries']
            ### This needs to go from semicolon to space delimited, and also make everything ints
            boundary_list = obj_bounds.split(' ')

            boundary_list_scaled = []
            boundary_string = ""
            for x in boundary_list:
                pt = x.split(",")
                boundary_string += "%d,%d " % ( float(pt[0])*2.0,float(pt[1])*2.0)                
            boundary_string = boundary_string[:-1]  ##removes the extra space at the end
            

            b = [boundary_string.encode('utf8'), str(random.randint(1,100000) ), "aqua"]  ### need to give the nuclei a random ID
            boundaryObject.append(b)
    print "nuclei were found?",nucleiAvail,slide,coll_name
    
    if boundaryObject:
        print boundaryObject[0]
    
    return dumps(boundaryObject)

@app.route('/static/<path:path>')
def static_proxy(path):
  # send_static_file will guess the correct MIME type
  return app.send_static_file(os.path.join('.', path))

@app.route('/<path:path>')
def static_file(path):
    return app.send_static_file(path)


@app.route('/thumbnail/<path:path>')
@crossdomain(origin='*')
@cache.cached()
def getThumbnail(path):
    """This will return the 0/0 tile later whch in the case of an SVS image is actually the thumbnail..... """
    #print "Looking in ",path,'for thumbnail.... which sould be expanded  I hope'

    path = os.path.abspath(os.path.join(app.basedir, path))
    osr = OpenSlide(path)
    format = 'jpeg'

    format = format.lower()
    if format != 'jpeg' and format != 'png':
        # Not supported by Deep Zoom
        abort(404)
    try:
        thumb = osr.get_thumbnail( (300,300))
    except ValueError:
        # Invalid level or coordinates
        abort(404)
    buf = PILBytesIO()
    thumb.save(buf, 'jpeg', quality=90)
    resp = make_response(buf.getvalue())
    resp.mimetype = 'image/%s' % format
    return resp

@app.route('/DZIMS/<path:path>.dzi')
@crossdomain(origin='*')
@cache.cached()
def dzi(path):
    slide = _get_slide(path)
    format = 'jpeg'
#    format = app.config['DEEPZOOM_FORMAT']
    resp = make_response(slide.get_dzi(format))
    resp.mimetype = 'application/xml'
    return resp

@app.route('/DZIMS/<path:path>_files/<int:level>/<int:col>_<int:row>.<format>')
@cache.cached()
def tile(path, level, col, row, format):
    log.setLevel(logging.ERROR)
#    log.disabled=True
    slide = _get_slide(path)
    format = format.lower()
    if format != 'jpeg' and format != 'png':
        # Not supported by Deep Zoom
        abort(404)
    try:
        tile = slide.get_tile(level, (col, row))
    except ValueError:
        # Invalid level or coordinates
        abort(404)
    buf = PILBytesIO()
    

#   tile.save(buf, format, quality=app.config['DEEPZOOM_TILE_QUALITY'])
    tile.save(buf, 'jpeg', quality=90)
    resp = make_response(buf.getvalue())
    resp.mimetype = 'image/%s' % format
    #log.setLevel(logging.INFO)

    return resp

class PILBytesIO(BytesIO):
    def fileno(self):
        '''Classic PIL doesn't understand io.UnsupportedOperation.'''
        raise AttributeError('Not supported')


### I need/want to add in a THUMB cache as well, as these are honestly the most used parameters...

class _SlideCache(object):
    def __init__(self, cache_size, dz_opts):
        self.cache_size = cache_size
        self.dz_opts = dz_opts
        self._lock = Lock()
        self._cache = OrderedDict()

    def get(self, path):
        with self._lock:
            if path in self._cache:
                # Move to end of LRU
                slide = self._cache.pop(path)
                self._cache[path] = slide
                return slide

        osr = OpenSlide(path)
        slide = DeepZoomGenerator(osr, **self.dz_opts)
        try:
            mpp_x = osr.properties[openslide.PROPERTY_NAME_MPP_X]
            mpp_y = osr.properties[openslide.PROPERTY_NAME_MPP_Y]
            slide.mpp = (float(mpp_x) + float(mpp_y)) / 2
        except (KeyError, ValueError):
            slide.mpp = 0

        with self._lock:
            if path not in self._cache:
                if len(self._cache) == self.cache_size:
                    self._cache.popitem(last=False)
                self._cache[path] = slide
        return slide

class _SlideFile(object):
    def __init__(self, relpath):
        self.name = os.path.basename(relpath)
        self.url_path = relpath


@app.before_first_request
def _setup():
    app.basedir = app.config['SLIDE_DIR']
    config_map = {
        'DEEPZOOM_TILE_SIZE': 'tile_size',
        'DEEPZOOM_OVERLAP': 'overlap',
        'DEEPZOOM_LIMIT_BOUNDS': 'limit_bounds',
    }
    opts = {
	'tile_size': 256,
	'overlap': 1,
	'limit_bounds': 0 
	}

	#dict((v, app.config[k]) for k, v in config_map.items())

    app.config['SLIDE_CACHE_SIZE']  = 1000
    app.cache = _SlideCache(app.config['SLIDE_CACHE_SIZE'], opts)

def _get_slide(path):
    path = os.path.abspath(os.path.join(app.basedir, path))
    #print path,"Is where I am looking";

    if not path.startswith(app.basedir + os.path.sep):
        # Directory traversal
        print os.path.sep,"is the separator??",app.basedir
        print "failing at the first part..."
        abort(404)
    if not os.path.exists(path):
        print "failing at the second part"

        abort(404)
    try:
        slide = app.cache.get(path)
        slide.filename = os.path.basename(path)
        return slide
    except OpenSlideError:
        abort(404)

