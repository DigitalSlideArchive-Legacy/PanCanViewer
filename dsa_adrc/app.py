from flask import Flask, request, redirect, url_for, send_from_directory,jsonify,make_response
from werkzeug.wsgi import DispatcherMiddleware

from bson.json_util import dumps
from flask_crossdomains import crossdomain
import gridfs

import random

import logging
log = logging.getLogger('werkzeug')

from flask.ext.cache import Cache

#http://stackoverflow.com/questions/18281433/flask-handling-a-pdf-as-its-own-page
pancan_config = {}
#pancan_config.slide_db_ptr = 'PanCanDSA_Slide_Data'

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

from collections import OrderedDict
from flask import Flask, abort, make_response, render_template, url_for
from io import BytesIO
import openslide
from openslide import OpenSlide, OpenSlideError
from openslide.deepzoom import DeepZoomGenerator
import os
from optparse import OptionParser
from threading import Lock

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
    ds = []
    coll_list = dsa_slide_db['PanCanDSA_Slide_Data'].distinct('slideGroup')
    for c in coll_list:
        ds.append( [c,c] )
    return dumps(  ds )


##[["GBM-172","GBM\/GBM-lymph-features-172.h5"],["GBM-27","GBM\/GBM-features-27.h5"],["GBM-49","GBM\/GBM-lymph-features-50.h5"],["GBM-88","GBM\/GBM-lymph-features-88.h5"],["GBM-92","GBM\/GBM-features-93.h5"],["LGG-188","LGG\/LGG-features-188.h5"],["LGG-21","LGG\/LGG-features-21.h5"],["LGG-67","LGG\/LGG-features-67.h5"],["LGG-88","LGG\/LGG-features-88.h5"],["SOX2","SOX2\/SOX2-features.h5"]]

@app.route('/db/getslides.php', methods=["POST"])
def mnv_getSlides():
    """This is a holding spot for Mike's get slide list"""
    dataset = request.form['dataset']
    print dataset
    sl = []
    return dumps( {'slide_list': dsa_slide_db['PanCanDSA_Slide_Data'].find({'slideGroup': dataset }) })
#ag return dumps( {'slide_list': dsa_slide_db['PanCanDSA_Slide_Data'].find({'slideGroup': coll_name }) })

@app.route('/db/getnuclei.php', methods=["POST"])
def getVisibleBoundaries():
    left   = request.form['left']    
    right  = request.form['right']
    top    = request.form['top']     
    bottom = request.form['bottom'] 
    slide  = request.form['slide']    
    uid = request.form['uid']
    trainSet = 'Not USED'
    print left,right,top,bottom,slide
    
    slide = 'TCGA-DX-AB2V-01Z-00-DX3'
    coll_name = "Features.V1.SARC.%s" % slide
    
    shim = [25,50,75,100]
    c1 =  "%d,%d %d,%d %d,%d %d,%d"
    
    left = int(float(left))
    right = int(float(right))
    top = int(float(right))
    bottom = int(float(right))


    boundaryObject=  []


    for x in shim:
        bound = c1 % ( left+x,top-x, right-x,top-x, right-x,bottom+x,left-x,bottom+x) 
        boundaryObject.append( [ bound, str(random.randint(1,10000) ), "blue" ])

    print boundaryObject
    return dumps(boundaryObject   )
 
    seg_obj_crsr = dbf[coll_name].find( { 'X': {"$gt": int(float(left)), "$lt": int(float(right))},
                                          'Y': {"$gt": int(float(top)),  "$lt": int(float(bottom))}
					 })
    
    nucleiAvail = seg_obj_crsr.count()
    
    if nucleiAvail < 200:
        for n in seg_obj_crsr:
            obj_bounds = n['Boundaries']
            ### This needs to go from semicolon to space delimited, and also make everything ints
            boundary_list = obj_bounds.split(';')
            boundary_string =  " ".join(boundary_list)
            boundary_string = boundary_string[:-1]  ##removes the extra space at the end
            b = [boundary_string, str(random.randint(1,100000) ), "aqua"]  ### need to give the nuclei a random ID
            boundaryObject.append(b)
    ##count()
    print "nuclei were found?",nucleiAvail,slide,coll_name
    
    #return 
    ##select boundary, id, centroid_x, centroid_y from boundaries where
    #slide = slide and centroid_x between left and right and centroid_y between top and bottom
    
    #return dumps( [["22007,12404 22013,12404 22013,12405 22016,12405 22016,12406 22018,12406 22018,12407 22020,12407 22020,12408 22022,12408 22022,12409 22023,12409 22023,12410 22025,12410 22025,12411 22026,12411 22026,12412 22026,12412 22026,12411 22025,12411 22025,12410 22023,12410 22023,12409 22022,12409 22022,12408 22018,12408 22018,12407 22017,12407 22017,12406 22011,12406 22011,12405 22008,12405 22008,12404 22007,12404","82804585","aqua"],["22014,13062 22015,13062 22015,13061 22016,13061 22016,13060 22018,13060 22018,13059 22020,13059 22020,13058 22020,13059 22021,13059 22021,13061 22020,13061 22020,13062 22018,13062 22018,13063 22016,13063 22016,13064 22016,13063 22015,13063 22015,13062 22014,13062","82804596","aqua"],["22012,12539 22015,12539 22015,12535 22014,12535 22014,12534 22014,12534 22014,12535 22015,12535 22015,12537 22016,12537 22016,12538 22017,12538 22017,12539 22021,12539 22021,12538 22024,12538 22024,12539 22025,12539 22025,12540 22027,12540 22027,12541 22028,12541 22028,12543 22027,12543 22027,12544 22026,12544 22026,12545 22025,12545 22025,12546 22024,12546 22024,12547 22023,12547 22023,12548 22021,12548 22021,12543 22014,12543 22014,12542 22013,12542 22013,12539 22012,12539","82804594","aqua"],["22013,11500 22014,11500 22014,11498 22015,11498 22015,11497 22016,11497 22016,11496 22017,11496 22017,11495 22020,11495 22020,11494 22021,11494 22021,11495 22023,11495 22023,11496 22025,11496 22025,11497 22026,11497 22026,11498 22027,11498 22027,11504 22026,11504 22026,11505 22026,11504 22025,11504 22025,11503 22024,11503 22024,11502 22021,11502 22021,11501 22020,11501 22020,11500 22014,11500 22014,11501 22014,11500 22013,11500","82796972","aqua"],["22017,12962 22018,12962 22018,12960 22019,12960 22019,12959 22019,12960 22024,12960 22024,12959 22024,12960 22025,12960 22025,12961 22026,12961 22026,12963 22026,12963 22026,12964 22019,12964 22019,12967 22019,12966 22018,12966 22018,12965 22017,12965 22017,12962","82804611","aqua"],["22015,13052 22016,13052 22016,13051 22017,13051 22017,13052 22021,13052 22021,13053 22026,13053 22026,13052 22027,13052 22027,13051 22027,13052 22028,13052 22028,13054 22027,13054 22027,13056 22026,13056 22026,13057 22026,13053 22022,13053 22022,13054 22021,13054 22021,13055 22021,13054 22018,13054 22018,13053 22016,13053 22016,13052 22015,13052","82804602","aqua"],["22017,12772 22018,12772 22018,12771 22019,12771 22019,12770 22020,12770 22020,12769 22021,12769 22021,12768 22025,12768 22025,12767 22025,12768 22028,12768 22028,12769 22029,12769 22029,12770 22030,12770 22030,12771 22030,12771 22030,12775 22029,12775 22029,12777 22028,12777 22028,12778 22027,12778 22027,12779 22026,12779 22026,12780 22024,12780 22024,12781 22021,12781 22021,12780 22019,12780 22019,12779 22018,12779 22018,12776 22017,12776 22017,12772","82804610","aqua"],["22016,12519 22017,12519 22017,12520 22025,12520 22025,12519 22026,12519 22026,12518 22027,12518 22027,12511 22027,12512 22028,12512 22028,12515 22029,12515 22029,12519 22028,12519 22028,12520 22027,12520 22027,12521 22026,12521 22026,12522 22025,12522 22025,12523 22024,12523 22024,12524 22020,12524 22020,12523 22019,12523 22019,12522 22018,12522 22018,12521 22017,12521 22017,12519 22016,12519","82804605","aqua"],["22016,11741 22017,11741 22017,11740 22022,11740 22022,11739 22024,11739 22024,11738 22026,11738 22026,11739 22027,11739 22027,11740 22028,11740 22028,11743 22029,11743 22029,11744 22030,11744 22030,11745 22031,11745 22031,11746 22032,11746 22032,11747 22033,11747 22033,11751 22034,11751 22034,11754 22035,11754 22035,11756 22034,11756 22034,11758 22033,11758 22033,11759 22032,11759 22032,11760 22030,11760 22030,11761 22027,11761 22027,11762 22026,11762 22026,11763 22025,11763 22025,11764 22024,11764 22024,11765 22022,11765 22022,11764 22021,11764 22021,11763 22020,11763 22020,11762 22019,11762 22019,11761 22018,11761 22018,11759 22017,11759 22017,11755 22016,11755 22016,11753 22017,11753 22017,11752 22018,11752 22018,11751 22019,11751 22019,11746 22018,11746 22018,11743 22017,11743 22017,11742 22016,11742 22016,11741","82796978","aqua"],["22019,11786 22020,11786 22020,11784 22021,11784 22021,11783 22022,11783 22022,11782 22024,11782 22024,11781 22027,11781 22027,11782 22028,11782 22028,11783 22030,11783 22030,11784 22031,11784 22031,11787 22030,11787 22030,11791 22029,11791 22029,11792 22028,11792 22028,11793 22027,11793 22027,11794 22026,11794 22026,11793 22023,11793 22023,11792 22021,11792 22021,11791 22020,11791 22020,11790 22019,11790 22019,11786","82796985","aqua"],["22016,12051 22017,12051 22017,12048 22018,12048 22018,12047 22019,12047 22019,12046 22020,12046 22020,12045 22021,12045 22021,12046 22024,12046 22024,12047 22029,12047 22029,12048 22030,12048 22030,12049 22031,12049 22031,12050 22032,12050 22032,12051 22033,12051 22033,12052 22034,12052 22034,12053 22035,12053 22035,12054 22037,12054 22037,12055 22038,12055 22038,12056 22038,12055 22033,12055 22033,12056 22030,12056 22030,12057 22029,12057 22029,12058 22026,12058 22026,12057 22025,12057 22025,12056 22020,12056 22020,12057 22019,12057 22019,12056 22018,12056 22018,12055 22017,12055 22017,12054 22016,12054 22016,12051","82796980","aqua"],["22016,11844 22017,11844 22017,11843 22018,11843 22018,11842 22019,11842 22019,11840 22020,11840 22020,11838 22021,11838 22021,11837 22022,11837 22022,11836 22023,11836 22023,11835 22025,11835 22025,11834 22026,11834 22026,11835 22026,11835 22026,11836 22024,11836 22024,11840 22025,11840 22025,11841 22027,11841 22027,11842 22030,11842 22030,11843 22032,11843 22032,11844 22033,11844 22033,11845 22034,11845 22034,11846 22035,11846 22035,11847 22036,11847 22036,11849 22037,11849 22037,11851 22036,11851 22036,11852 22035,11852 22035,11853 22034,11853 22034,11854 22032,11854 22032,11855 22028,11855 22028,11854 22027,11854 22027,11853 22025,11853 22025,11852 22021,11852 22021,11851 22020,11851 22020,11850 22019,11850 22019,11849 22018,11849 22018,11848 22017,11848 22017,11847 22016,11847 22016,11844","82796979","aqua"],["22017,12451 22021,12451 22021,12449 22022,12449 22022,12448 22023,12448 22023,12447 22024,12447 22024,12446 22026,12446 22026,12445 22027,12445 22027,12443 22028,12443 22028,12442 22029,12442 22029,12438 22029,12438 22029,12437 22030,12437 22030,12438 22031,12438 22031,12440 22032,12440 22032,12441 22033,12441 22033,12445 22032,12445 22032,12448 22031,12448 22031,12449 22030,12449 22030,12450 22028,12450 22028,12451 22027,12451 22027,12452 22026,12452 22026,12453 22024,12453 22024,12454 22022,12454 22022,12455 22021,12455 22021,12456 22019,12456 22019,12453 22018,12453 22018,12452 22017,12452 22017,12451","82804609","aqua"],["22025,12938 22026,12938 22026,12937 22027,12937 22027,12935 22028,12935 22028,12934 22029,12934 22029,12933 22029,12936 22029,12936 22029,12937 22028,12937 22028,12941 22028,12941 22028,12940 22027,12940 22027,12939 22026,12939 22026,12938 22025,12938","82804627","aqua"],["22024,11887 22025,11887 22025,11886 22026,11886 22026,11885 22026,11886 22028,11886 22028,11887 22032,11887 22032,11888 22031,11888 22031,11889 22030,11889 22030,11891 22029,11891 22029,11892 22028,11892 22028,11893 22028,11892 22027,11892 22027,11891 22026,11891 22026,11890 22025,11890 22025,11889 22024,11889 22024,11887","82796996","aqua"]] )
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

