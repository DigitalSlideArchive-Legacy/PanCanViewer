//
//	Copyright (c) 2014-2015, Emory University
//	All rights reserved.
//
//	Redistribution and use in source and binary forms, with or without modification, are
//	permitted provided that the following conditions are met:
//
//	1. Redistributions of source code must retain the above copyright notice, this list of
//	conditions and the following disclaimer.
//
//	2. Redistributions in binary form must reproduce the above copyright notice, this list 
// 	of conditions and the following disclaimer in the documentation and/or other materials
//	provided with the distribution.
//
//	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
//	EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
//	OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT
//	SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
//	INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED 
//	TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR
//	BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
//	CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY
//	WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
//	DAMAGE.
//
//
console.log("loading CS Lite viewer.js");



var seg_base_url = "http://turing.cci.emory.edu/VALS/"

var annoGrpTransformFunc;
var IIPServer="";
var slideCnt = 0;
var curSlide = "";
var curDataset = "";
var curDataset = null;
var curClassifier = "none";

var viewer = null;
var imgHelper = null, osdCanvas = null, viewerHook = null;
var overlayHidden = false, selectMode = false, segDisplayOn = false;;
var olDiv = null;
var lastScaleFactor = 0;
var pyramids, trainingSets;
var clickCount = 0;					

// The following only needed for active sessions
var uid = null, negClass = "", posClass = "";			

var boundsLeft = 0, boundsRight = 0, boundsTop = 0, boundsBottom = 0;
var	panned = false;
var	pannedX, pannedY;

var fixes = {iteration: 0, accuracy: 0, samples: []};

var heatmapLoaded = false;
var slideReq = null;
var uncertMin = 0.0, uncertMax = 0.0, classMin = 0.0, classMax = 0.0;


// //
// //	Initialization
// //	
// //		Get a list of available slides from the database
// //		Populate the selection and classifier dropdowns
// //		load the first slide
// //		Register event handlers
// //


$(function() {
	slideReq = $_GET('slide');

	// Create the slide zoomer, update slide count etc...
	// We will load the tile pyramid after the slide list is loaded
	//
	viewer = new OpenSeadragon.Viewer({ showNavigator: true, id: "image_zoomer", prefixUrl: "images/", animationTime: 0.5});
	console.log("Viewer opened");
       viewer.addHandler('open-failed', function(evt) {
            console.log('tile source opening failed', evt);
        })


        viewer.addHandler('animation', function() {
            var bounds = viewer.viewport.getBounds();
            var message = bounds.x + ':' + bounds.y + ':' + bounds.width + ':' + bounds.height;
            $('.wsi-toolbar').text(message);
        });


	imgHelper = viewer.activateImagingHelper({onImageViewChanged: onImageViewChanged});
    viewerHook = viewer.addViewerInputHook({ hooks: [
                    {tracker: 'viewer', handler: 'clickHandler', hookHandler: onMouseClick}
            ]});

//dg_svg_layer = viewer.svgOverlay(); 

	//console.log('rocking out so far...')
	//fF = 2.0  ; //FudgeFactor
	annoGrpTransformFunc = ko.computed(function() { 
					return 'translate(' + svgOverlayVM.annoGrpTranslateX() +
						', ' + svgOverlayVM.annoGrpTranslateY() +
					') scale(' + svgOverlayVM.annoGrpScale() + ')';
						}, this); 
	
	//
	// Image handlers
	//	
	viewer.addHandler('open', function(event) {
  		console.log('Image has been opened');
		osdCanvas = $(viewer.canvas);
		statusObj.haveImage(true);

		osdCanvas.on('mouseenter.osdimaginghelper', onMouseEnter);
		osdCanvas.on('mousemove.osdimaginghelper', onMouseMove);
		osdCanvas.on('mouseleave.osdimaginghelper', onMouseLeave);

		statusObj.imgWidth(imgHelper.imgWidth);
		statusObj.imgHeight(imgHelper.imgHeight);
		statusObj.imgAspectRatio(imgHelper.imgAspectRatio);
		statusObj.scaleFactor(imgHelper.getZoomFactor());
	});



	viewer.addHandler('close', function(event) {
		osdCanvas = $(viewer.canvas);

		statusObj.haveImage(false);
		
        osdCanvas.off('mouseenter.osdimaginghelper', onMouseEnter);
        osdCanvas.off('mousemove.osdimaginghelper', onMouseMove);
        osdCanvas.off('mouseleave.osdimaginghelper', onMouseLeave);

		osdCanvas = null;
	});

	
	viewer.addHandler('animation-finish', function(event) {

		if( segDisplayOn ) {
		
			if( statusObj.scaleFactor() > 0.5 ) {


				//console.log('should be showing objects now..');

				// Zoomed in, show boundaries hide heatmap
				$('#anno').show();
				$('#heatmapGrp').hide();

				var centerX = statusObj.dataportLeft() + 
							  ((statusObj.dataportRight() - statusObj.dataportLeft()) / 2);
				var centerY = statusObj.dataportTop() + 
							  ((statusObj.dataportBottom() - statusObj.dataportTop()) / 2);
				
				if( centerX < boundsLeft || centerX > boundsRight ||
					centerY < boundsTop || centerY > boundsBottom ) {

					// Only update boundaries if we've panned far enough.							
					updateSeg();
				}
				 
			} else {
					
				updateSeg();

				// Zoomed out, hide boundaries, show heatmap
				$('#anno').hide();
				$('#heatmapGrp').show();

				// Reset bounds to allow boundaries to be drawn when
				// zooming in from a heatmap.
				boundsLeft = boundsRight = boundsTop = boundsBottom = 0;
			}
		}
	});

	// get slide host info
	//

	
	// Set the update handlers for the selectors
	$("#slide_sel").change(updateSlide);
	$("#dataset_sel").change(updateDataset);


	// Set filter for numeric input
	$("#x_pos").keydown(filter);
	$("#y_pos").keydown(filter);


});





// // Filter keystrokes for numeric input
function filter(event) {

	// Allow backspace, delete, tab, escape, enter and .	
	if( $.inArray(event.keyCode, [46, 8, 9, 27, 13, 110, 190]) !== -1 ||
		// Allow Ctrl-A
	   (event.keyCode == 65 && event.ctrlKey === true) ||
		// Allow Ctrl-C
	   (event.keyCode == 67	&& event.ctrlKey === true) ||
		// Allow Ctrl-X
	   (event.keyCode == 88	&& event.ctrlKey === true) ||
		// Allow home, end, left and right
	   (event.keyCode >= 35	&& event.keyCode <= 39) ) {

			return;
	}
	
	// Don't allow if not a number
	if( (event.shiftKey || event.keyCode < 48 || event.keyCode > 57) &&
		(event.keyCode < 96 || event.keyCode > 105) ) {

			event.preventDefault();
	}
}


 
//
//	Get the url for the slide pyramid and set the viewer to display it
//
//
function updatePyramid() {

	slide = "";
	panned = false;
	heatmapLoaded = false;

	// Zoomer needs '.dzi' appended to the end of the filename
	//#pyramid = "DeepZoom="+pyramids[$('#slide_sel').prop('selectedIndex')]+".dzi";
        //I alrady set the .dzi property on the python server side
	pyramid = pyramids[$('#slide_sel').prop('selectedIndex')];
	viewer.open(IIPServer + pyramid);
}


//
//	Updates the dataset selector
//
function updateDatasetList() {

	var	datasetSel = $("#dataset_sel");
	console.log('Updating datasets');
	

	// Get a list of datasets
	$.ajax({
		url: "db/getdatasets.php",
		data: "",
		dataType: "json",
		success: function(data) {
			
			//Need to change this to the format I am using...
			console.log("Data sets haev been retrieved from the server...");
			console.log(data);
			console.log(curDataset);


			for( var item in data ) {
				datasetSel.append(new Option(data[item][0], data[item][0]));
			}

			if( curDataset === null ) {
				curDataset = data[0][0];		// Use first dataset initially
				console.log("Setting current data sets....");
				console.log(curDataset);
			} else {
				datasetSel.val(curDataset);
			}
									
			// Need to update the slide list since we set the default slide
			//Should be updating the slide list now
			console.log('Just finished laoding the main data set, now loading the slides');
			updateSlideList();
			
		}
	});
}





//
//	Updates the list of available slides for the current dataset
//
function updateSlideList() {
	var slideSel = $("#slide_sel");
	var slideCntTxt = $("#count_patient");
    console.log("Loading Slide Sets now");
	console.log(curDataset);
	console.log("Should have just pushed the dataset...");

//			slideCntTxt.text(slideCnt);

//			slideSel.empty();


	//  $.getJSON("db/getslides.php").then(function(data) {
	// console.log(data);
	// console.log("WAS RETURNED??");
 //            $.each(data.slide_list, function(idx, value) {
	// 	console.log(idx,value);
			
 //                slideSel.append('<option value="' + value.slide_name + '" id="' + value + '">' + value.slide_name + '</option>');
 //            })
 //        });


	// Get the list of slides for the current dataset
	$.ajax({
		type: "POST",
		url: "db/getslides.php",
		data: { dataset: curDataset },
		dataType: "json",
		success: function(data) {

			var index = 0;

			pyramids = data['paths'];
			if( slideReq === null ) {
				curSlide = String(data['slides'][0]);		// Start with the first slide in the list
			} else {
				curSlide = slideReq;
			}
 
			slideCnt = Object.keys(data['slides']).length;;
			slideCntTxt.text(slideCnt);

			slideSel.empty();
			// Add the slides we have segmentation boundaries for to the dropdown
			// selector
			for( var item in data['slides'] ) {
				
				if( slideReq != null && slideReq == data['slides'][item] ) {
					index = item;
				}
				slideSel.append(new Option(data['slides'][item], data['slides'][item]));
			}

			if( index != 0 ) {
				$('#slide_sel').prop('selectedIndex', index);
			}

			// Get the slide pyrimaid and display	
			updatePyramid();
		}
	});
}



//
//	A new slide has been selected from the drop-down menu, update the 
// 	slide zoomer.
//
//
function updateSlide() {
	curSlide = $('#slide_sel').val();
	updatePyramid();
	if( segDisplayOn ) {updateSeg(); }
}


//
//
//
//
function updateDataset() {
	curDataset = $('#dataset_sel').val();
	updateSlideList();
}


//
//	Update annotation and viewport information when the view changes 
//  due to panning or zooming.
//
//
function onImageViewChanged(event) {

	var boundsRect = viewer.viewport.getBounds(true);

	// Update viewport information. dataportXXX is the view port coordinates
	// using pixel locations. ie. if dataPortLeft is  0 the left edge of the 
	// image is aligned with the left edge of the viewport.
	//
	statusObj.viewportX(boundsRect.x);
	statusObj.viewportY(boundsRect.y);
	statusObj.viewportW(boundsRect.width);
	statusObj.viewportH(boundsRect.height);
	statusObj.dataportLeft(imgHelper.physicalToDataX(imgHelper.logicalToPhysicalX(boundsRect.x)));
	statusObj.dataportTop(imgHelper.physicalToDataY(imgHelper.logicalToPhysicalY(boundsRect.y)) * imgHelper.imgAspectRatio);
	statusObj.dataportRight(imgHelper.physicalToDataX(imgHelper.logicalToPhysicalX(boundsRect.x + boundsRect.width)));
	statusObj.dataportBottom(imgHelper.physicalToDataY(imgHelper.logicalToPhysicalY(boundsRect.y + boundsRect.height))* imgHelper.imgAspectRatio);
	statusObj.scaleFactor(imgHelper.getZoomFactor());

	var p = imgHelper.logicalToPhysicalPoint(new OpenSeadragon.Point(0, 0));
	
	svgOverlayVM.annoGrpTranslateX(p.x);
	svgOverlayVM.annoGrpTranslateY(p.y);
	svgOverlayVM.annoGrpScale(statusObj.scaleFactor());	
	
	var annoGrp = document.getElementById('annoGrp');
	annoGrp.setAttribute("transform", annoGrpTransformFunc());	
}




//
//	Retreive the boundaries for nuclei within the viewport bounds and an 
//	area surrounding the viewport. The are surrounding the viewport is a
//	border the width and height of the viewport. This allows the user to pan a full
//	viewport width or height before having to fetch new boundaries.
//
//
function updateSeg() {

	var ele, segGrp, annoGrp;

	if( statusObj.scaleFactor() > 0.5 ) {
	
		var left, right, top, bottom, width, height;

		// Grab nuclei a viewport width surrounding the current viewport
		//
		width = statusObj.dataportRight() - statusObj.dataportLeft();
		height = statusObj.dataportBottom() - statusObj.dataportTop();
		
		left = (statusObj.dataportLeft() - width > 0) ?	statusObj.dataportLeft() - width : 0;
		right = statusObj.dataportRight() + width;
		top = (statusObj.dataportTop() - height > 0) ?	statusObj.dataportTop() - height : 0;
		bottom = statusObj.dataportBottom() + height;
		 		
                //console.log('should be doing stuff to update the svg layer in here...');
	    $.ajax({
			type: "POST",
       	 	url: "db/getnuclei.php",
       	 	dataType: "json",
			data: { uid:	uid,
					slide: 	curSlide,
					left:	left,
					right:	right,
					top:	top,
					bottom:	bottom,
					dataset: curDataset,
					trainset: curClassifier
			},
		
			success: function(data) {
					
					segGrp = document.getElementById('segGrp');
					annoGrp = document.getElementById('anno');
					
					// Save current viewport location
					boundsLeft = statusObj.dataportLeft();
					boundsRight = statusObj.dataportRight();
					boundsTop = statusObj.dataportTop();
					boundsBottom = statusObj.dataportBottom();

					// If group exists, delete it
					if( segGrp != null ) {
						segGrp.parentNode.removeChild(segGrp);
					}

					// Create segment group
                    segGrp = document.createElementNS("http://www.w3.org/2000/svg", "g");
                    segGrp.setAttribute('id', 'segGrp');
                    annoGrp.appendChild(segGrp);
						//console.log('i hope i found data???');
						//console.log(data);


   //  This will iterate through all the tiles and color them a different color to show the tile overlays
//    $(".tileClass").remove();
  //  my_points = contourdata_to_shape(new_geodata, img_width);
    //This generates the pretty multicolor tile image
   // $.each(my_points, function(k, point_list) {
   // });

// 					for ( cell in data )

// 					{
// 					console.log(data[cell]);
// 				//dg_svg_layer
// 		//I need to rescale the nuclei from 0/1
//                 ptData = data[cell][0]
//                 console.log(data[cell][0]);

// 		ptList = ptData.split(" ");


// 	imgWidth = 125000;
// 	console.log(ptList,ptData);
// 	reCast_Pts = ""; $.each(ptList, function(k,v) {  xy = v.split(','); rc = ' '+ ( xy[0]/imgWidth).toString() + ',' + (xy[1]/imgWidth).toString(); reCast_Pts+= rc; } ); console.log(reCast_Pts)
//         //### I am better off recasting the poitns on the server side..
// 	d3.select(dg_svg_layer.node()).append("polygon").attr("points", reCast_Pts).style('fill', 'none').attr('opacity', 0.5).attr('class', 'tileClass').attr('id', 'N' + data[cell][1]).attr('stroke','aqua');
		

// //        d3.select(svg_layer.node()).append("polygon").attr("points", point_list.coords).style('fill', 'none').attr('opacity', 0.5).attr('class', 'tileClass').attr('id', 'tile' + point_list.labelindex)

// 					}



					items_added = 0;
					for( cell in data ) {
				console.log("Should be using mike's code now??");
						ele = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
						//console.log(cell);
						//console.log('are there any celllllls???');
						//console.log(data[cell],"is the cell data i think?");
						ele.setAttribute('points', data[cell][0]);
						ele.setAttribute('id', 'N' + data[cell][1]);
						ele.setAttribute('stroke', data[cell][2]);
						ele.setAttribute('fill', 'none');
						
						segGrp.appendChild(ele);
                                           items_added +=1;
					}
						console.log(items_added);
					if( panned ) {
						ele = document.createElementNS("http://www.w3.org/2000/svg", "rect");
			
						ele.setAttribute('x', pannedX - 50);
						ele.setAttribute('y', pannedY - 50);
						ele.setAttribute('width', 100);
						ele.setAttribute('height', 100);
						ele.setAttribute('stroke', 'yellow');
						ele.setAttribute('fill', 'none');
						ele.setAttribute('stroke-width', 4);
						ele.setAttribute('id', 'boundBox');
			
						segGrp.appendChild(ele);
					}
					
					if( fixes['samples'].length > 0 ) {
						updateBoundColors();
					}
        		}
    	});
	} else {

	}
}





// function nucleiSelect() {

// 	if( classifierSession == false ) {
// 		$.ajax({
// 		    type:   "POST",
// 		    url:    "db/getsingle.php",
// 		    dataType: "json",
// 		    data:   { slide:    curSlide,
// 		              cellX:    Math.round(statusObj.mouseImgX()),
// 		              cellY:    Math.round(statusObj.mouseImgY())
// 		            },
// 		    success: function(data) {
// 		            if( data !== null ) {

// 						if( curClassifier === "none" ) {
// 							// No classifier applied, just log results
// 			                console.log(curSlide+","+data[2]+","+data[3]+", id: "+data[1]);
// 			            } else {
// 			            	// We're adding an object, make sure the retrain button is enabled.
// 			            	$('#retrainBtn').removeAttr('disabled');

// 							var	obj = {slide: curSlide, centX: data[2], centY: data[3], label: 0, id: data[1]};
// 			            	var cell = document.getElementById("N"+obj['id']);
			            	
// 							// Flip the label here. lime indicates the positive class, so we
// 							// want to change the label to -1. Change to 1 for lightgrey. If
// 							// the color is niether, the sample has been picked already so
// 							// ignore.
// 							//
// 							if( cell.getAttribute('stroke') === "lime" ) {
// 								obj['label'] = -1;
// 							} else if( cell.getAttribute('stroke') === "lightgrey" ) {
// 								obj['label'] = 1;
// 							}

// 							if( obj['label'] != 0 ) {
// 				                fixes['samples'].push(obj);
				                
// 				                updateBoundColors();
// 				                statusObj.samplesToFix(statusObj.samplesToFix() + 1);
// 				            }
// 			            }
// 		            }
// 		        }
// 		});
// 	}
// }



// //
// // ===============	Mouse event handlers for viewer =================
// //

//
//	Mouse enter event handler for viewer
//
//
function onMouseEnter(event) {
	statusObj.haveMouse(true);
}


//
// Mouse move event handler for viewer
//
//
function onMouseMove(event) {
	var offset = osdCanvas.offset();

	statusObj.mouseRelX(event.pageX - offset.left);
	statusObj.mouseRelY(event.pageY - offset.top);		
	statusObj.mouseImgX(imgHelper.physicalToDataX(statusObj.mouseRelX()));
	statusObj.mouseImgY(imgHelper.physicalToDataY(statusObj.mouseRelY()));
}


//
//	Mouse leave event handler for viewer
//
//
function onMouseLeave(event) {
	statusObj.haveMouse(false);
}



function onMouseClick(event) {

    clickCount++;
    if( clickCount === 1 ) {
        // If no click within 250ms, treat it as a single click
        singleClickTimer = setTimeout(function() {
                    // Single click
                    clickCount = 0;
                }, 250);
    } else if( clickCount >= 2 ) {
        // Double click
        clearTimeout(singleClickTimer);
        clickCount = 0;
        nucleiSelect();
    }
}



//
// =======================  Button Handlers ===================================
//



//
//	Load the boundaries for the current slide and display
//
//
function viewSegmentation() {

	var	segBtn = $('#btn_1');

	if( segDisplayOn ) {
		// Currently displaying segmentation, hide it
		segBtn.val("Show Segmentation");
		$('.overlaySvg').css('visibility', 'hidden');
		segDisplayOn = false;
	} else {
		// Segmentation not currently displayed, show it
		segBtn.val("Hide Segmentation");
		$('.overlaySvg').css('visibility', 'visible');
		segDisplayOn = true;
		
		updateSeg();
	}
}




function go() {

	var	segBtn = $('#btn_1');
	
	pannedX = $("#x_pos").val();
	pannedY = $("#y_pos").val();

	// TODO! - Need to validate location against size of image
	if( pannedX === "" || pannedY === "" ) {
		window.alert("Invalid position");
	} else {
		
		// Turn on overlay and reset bounds to force update
		segBtn.val("Hide Segmentation");
		$('.overlaySvg').css('visibility', 'visible');
		segDisplayOn = true;
		boundsLeft = boundsRight = boundsTop = boundsBottom = 0;

		// Zoom in all the way
		viewer.viewport.zoomTo(viewer.viewport.getMaxZoom());

		// Move to nucei		
		imgHelper.centerAboutLogicalPoint(new OpenSeadragon.Point(imgHelper.dataToLogicalX(pannedX), 
															  imgHelper.dataToLogicalY(pannedY)));
		panned = true;
	}	
}




//
// Retruns the value of the GET request variable specified by name
//
//
function $_GET(name) {
	var match = RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
	return match && decodeURIComponent(match[1].replace(/\+/g,' ')); 
}




//
// Image data we want knockout.js to keep track of
//
var statusObj = {
	haveImage: ko.observable(false),
	haveMouse: ko.observable(false),
	imgAspectRatio: ko.observable(0),
	imgWidth: ko.observable(0),
	imgHeight: ko.observable(0),
	mouseRelX: ko.observable(0),
	mouseRelY: ko.observable(0),
	mouseImgX: ko.observable(0),
	mouseImgY: ko.observable(0),
	scaleFactor: ko.observable(0),
	viewportX: ko.observable(0),
	viewportY: ko.observable(0),
	viewportW: ko.observable(0),
	viewportH: ko.observable(0),
	dataportLeft: ko.observable(0),
	dataportTop: ko.observable(0),
	dataportRight: ko.observable(0),
	dataportBottom: ko.observable(0),
	samplesToFix: ko.observable(0)
};


var svgOverlayVM = {
	annoGrpTranslateX:	ko.observable(0.0),
	annoGrpTranslateY:	ko.observable(0.0),
	annoGrpScale: 		ko.observable(1.0),
	annoGrpTransform:	annoGrpTransformFunc
};

var vm = {
	statusObj:	ko.observable(statusObj),
	svgOverlayVM: ko.observable(svgOverlayVM)
};



// Apply binsing for knockout.js - Let it keep track of the image info
// and mouse positions
//
ko.applyBindings(vm);



//     /*
//      New code for loading in image data from the mongo database
//     */

//     function load_thumbnail_data(name) {
//         recent_study_name = name;
//         var html_for_dt = [];

//         $.getJSON(base_host + '/api/v1/collections/slides/' + name).then(function(data) {
//             thumbs[name] = data.slide_list;
//             //now want to load the data into the data table object
//             html_for_dt = []; //html for data table input
//             $.each(data.slide_list, function(idx, sld_info) {

//                     //converted_URL for local src =..
//                     // add thumbnail as well

//                     var html = sld_info.slide_name + '#' + sld_info.slide_w_path + '#' + sld_info.slide_name + '#' + sld_info.thumbnail_image;
//                     html_for_dt.push([html]);
//                     //console.log(html);

//                 })
//                 //   console.log(html_for_dt);
//                 //return false; //http://stackoverflow.com/questions/8224375/jquery-each-stop-loop-and-return-object
//             load_slides_into_datatable(html_for_dt, 1); //This is a single column view
//             //return html_for_dt;  //TO DO: Explain why if I return this here it's blank; need to clarify async functionality
//         })

//     }



//     function load_slides_into_datatable(html_for_dataTable, images_per_row) {

//         //Below formats the data for either a 1 or 5 column data view
//         //There are also separate call back functions for the single and 5 column viewer... but at least I consolidated
//         // the function calls

//         if (images_per_row == 1) {
//             aoColumns = [{
//                 "sTitle": "Image",
//                 "sClass": "center",
//                 "sType": "html"
//             }];
//             callback_to_use = customFnRowCallback;
//         } else if (images_per_row == 5) {
//             aoColumns = [{
//                 "sTitle": "Image",
//                 "sClass": "center",
//                 "sType": "html"
//             }, {
//                 "sTitle": "Image",
//                 "sClass": "center",
//                 "sType": "html"
//             }, {
//                 "sTitle": "Image",
//                 "sClass": "center",
//                 "sType": "html"
//             }, {
//                 "sTitle": "Image",
//                 "sClass": "center",
//                 "sType": "html"
//             }, {
//                 "sTitle": "Image",
//                 "sClass": "center",
//                 "sType": "html"
//             }]

//             callback_to_use = customFnRowCallback_expanded;

//         }
//         console.log(aoColumns);

//         ///I am currently using data tables for the thumbnail browser on the left, this code below loads it
//         $('#count_patient').text(html_for_dataTable.length);
//         $('#dynamic').html('<table cellpadding="0" cellspacing="0" border="0" class="display" id="example"></table>');
//         oTable = $('#example').dataTable({
//             "aaData": html_for_dataTable,
//             "bLengthChange": false,
//             "bSort": false,
//             "bSortClasses": false,
//             "iDisplayLength": 6,
//             "bDeferRender": true,
//             "fnRowCallback": callback_to_use,
//             "aoColumns": aoColumns
//         });



//     }





//     function load_expanded_thumbnail_data(name) {

//         //This is a slightly different endpoint as instead of loading a column of data, I am loading 5 columns of data at a time...
//         //but basic functionality is similar to above
//         //all this is doing is basically reformatting the data for datatables


//         recent_study_name = name;
//         var html_for_expanded_dt = [];
//         //This actually doesn't require me to load any data...
//         //now want to load the data into the data table object
//         //Now I need to load 5 slides per row, instead of 1
//         if (!thumbs_expanded.hasOwnProperty(name)) {
//             thumbs_expanded[name] = [];
//             console.log(thumbs[name]);
//             for (var i = 0; i <= thumbs[name].length - thumbs[name].length % 5; i += 5) {
//                 if (i == thumbs[name].length) break; //may need to make sure I don't need to push whatever is in the current row
//                 var row = [];
//                 for (var j = 0; j < 5 && ((i + j) < thumbs[name].length); j++) {

//                     //Each row actually has the following info
//                     var cur_html = thumbs[name][i + j].slide_name + '#' + thumbs[name][i + j].slide_url + '#' + thumbs[name][i + j].slide_name + '#' + thumbs[name][i + j].thumbnail_image;

//                     row.push(cur_html);
//                     //console.log(thumbs[name[i+j]]);
//                 }
//                 while (row.length < 5) {
//                     row.push("");
//                 }

//                 thumbs_expanded[name].push(row);
//                 console.log(row);
//             }
//         }

//         //console.log(html);

//         load_slides_into_datatable(thumbs_expanded[name], 5);
//     }



//     function load_image(filename, image_url) {
//         console.log(filename);

//         if (sel_image_expanded) {
//             $('#sel_image_frame').addClass('span3');
//             $('#sel_image_frame').removeClass('span12');
//             $('#zoom_frame').show();
//             load_thumbnail_data(recent_study_name);
//             sel_image_expanded = false;
//         }

//         annotationState.clearAnnotations();
//         viewer.open(image_url);


//         //Once an image is selected, buttons become clickable depending on the data source
//         $('#show_filter').removeAttr('disabled');
//         current_filename = filename;
//         current_slide_url = image_url;
//         $("#status_bar").text("Current image:" + current_filename); //update status bar to show current image name

//         /// I am now loading the database function here..
//         pid = filename.substring(0, 12);

//         /* Ill get the path report here */


//     }



//     //Function for Delayed loading of thumbnails
//     //See http://www.datatables.net/forums/discussion/1959/image-thumbs-in-table-column-lazy-loading/p1 for example
//     function customFnRowCallback(nRow, aData, iDisplayIndex) {
//         var rowdata = aData[0].split('#');
//         //             console.log(rowdata);
//         var html = '<a href=\"javascript:;\" onclick=\"load_image(\'' + rowdata[0] + '\',\'' + rowdata[1] + '\')\">' + rowdata[2] + '<br /><img src=\"' + rowdata[3] + '\"></a>';
//         $('td:eq(0)', nRow).html(html);
//         return nRow;
//     }

//     function customFnRowCallback_expanded(nRow, aData, iDisplayIndex) {
//         for (var i = 0; i < 5; i++) {
//             if (aData[i] == "") {
//                 $('td:eq(' + i + ')', nRow).html('');
//                 continue;
//             }
//             var rowdata = aData[i].split('#');
//             var html = '<a href=\"javascript:;\" onclick=\"load_image(\'' + rowdata[0] + '\',\'' + rowdata[1] + '\')\">' + rowdata[2] + '<br /><img src=\"' + rowdata[3] + '\"></a>';
//             $('td:eq(' + i + ')', nRow).html(html);
//         }
//         return nRow;
//     }



//     /*Adding code for a floating debug window... */
//     $('#annotationState_dialog').dialog({
//         autoOpen: false,
//         modal: false,
//         draggable: true,
//         width: 550,
//         height: 375,
//     });

//     $('#AnnotationDialogButton').on('click', function() {
//         $('#annotationState_dialog').dialog('open');
//     });

//     /* This second debug window displays the color and shape that was selected */
//     $('#annotationControlPanel_dialog').dialog({
//         autoOpen: false,
//         modal: false,
//         draggable: true,
//         width: 575,
//         height: 375,
//     });

//     $('#AnnotationControlButton').on('click', function() {
//         $('#annotationControlPanel_dialog').dialog('open');
//     });



//     //  window.annotationStateControls = new AnnotationStateContro
//     function getParameterByName(name) {
//         name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
//         var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
//             results = regex.exec(location.search);
//         return results == null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
//     }
//     var config;
//     var sel_image_expanded = false;
//     var study_name = [];
//     var thumbs_xml;
//     var thumbs = {};
//     var thumbs_expanded = {};
//     var recent_study_name;
//     var viewer;
//     var annotationState;
//     var pid;
//     var patient_data = {};
//     var temp;
//     var oTable;
//     var current_filename;
//     var current_slide_url;
//     var mousetracker;
//     var osd;
//     var PRECISION = 3;


//     //consider this slider http://bxslider.com/ content slider

//     // also check out this one..http://sachinchoolur.github.io/lightslider/examples.html
//     function handleResize() {

//         console.log('resize');





//         // this is expensive, easier to just save these long term, but oh well.

//         var nav_height = $(".navbar").height();
//         var status_bar_height = $('#status_bar').height();
//         var select_patient_height = $("#sel_patient").height();
//         var left_width = $('#sel_image_frame').width();

//         console.log(nav_height, status_bar_height, select_patient_height, left_width);

//         $('#sel_image_scroll').height(window.innerHeight - (nav_height + status_bar_height + select_patient_height + 70));
//         $('#zoom_frame').width(window.innerWidth - left_width - 10);
//         $('#image_zoomer').width(window.innerWidth - left_width - 10);
//         $('#image_zoomer').height(window.innerHeight - (nav_height + status_bar_height));
//         $('.openseadragon-container').height(window.innerHeight - (nav_height + status_bar_height));
//     }

//     window.onresize = handleResize;

$(document).ready(function() 
	{

	console.log('Loading main data set now');
	updateDatasetList();

	});


//      $(document).ready(function() {
//         handleResize();

//         var xhr = $.ajax({
//             type: "GET",
//             url: "config.json",
//             async: false
//         });
//         config = JSON.parse(xhr.responseText);
//         xhr = $.ajax({
//             type: "GET",
//             url: config.study_name_url,
//             async: false
//         });

//         //New Cleaner way to get the data from Mongo ..
//         //This pulls the data groups /tumor types and populates the main dropdown box

//         $.getJSON(datagroup_apiurl).then(function(data) {
//             $.each(data.Collections, function(idx, value) {
//                 $('#data_group').append('<option value="' + value + '" id="' + value + '">' + value + '</option>');
//             })
//         });

//         //This code would allow me to instead of loading the default data group and/or select statement
//         //would allow me to pass a URL parameter to go to a specific gtumor group
//         if (getParameterByName('data_grp') == "") {
//             load_thumbnail_data(study_name[0]);
//         } else {
//             $('#data_group').val(getParameterByName('data_grp'));
//             load_thumbnail_data(getParameterByName('data_grp'));
//         }
//         //create the filter dialog  as a model
//         $("#filter_dialog").dialog({
//             autoOpen: false,
//             width: 'auto'
//         });
//         //Filter dialog only opens on click....
//         $('#show_filter').click(function() {
//             $('#filter_dialog').dialog('open');
//             return false;
//         });

//         $("#debug_dialog").dialog({
//             autoOpen: false,
//             width: 'auto'
//         });
//         $("#show_debug").click(function() {
//             $("#debug_dialog").dialog('open');
//             return false;
//         });

//         $("#annotation_dialog").dialog({
//             autoOpen: false,
//             width: 'auto'
//         });
//         $("#show_annotator").click(function() {
//             $("#annotation_dialog").dialog('open');

//             //annotation_setup_code();
//             console.log('annotation code loaded');
//             return false;
//             //come back here
//         });

//         $("#query_db_dialog").dialog({
//             autoOpen: false,
//             width: 'auto'
//         });

//         $("#show_metadata").click(function() {
//             $("#query_db_dialog").dialog('open');

//             //annotation_setup_code();
//             console.log('metadata  code loaded');
//             return false;
//             //come back here
//         });


//         $(".sel_image_action").click(function() {

//             console.log('here?');

//             if (!sel_image_expanded) {

//                 console.log('gets here');
//                 //This code allows me to change the view from a single image thumb on the right to show multiple thumbs per page

//                 // removing this in favor of class values
//                 $('#sel_image_frame').removeClass('span3');
//                 $('#sel_image_frame').addClass('span12');
//                 $('#zoom_frame').hide();

//                 load_expanded_thumbnail_data(recent_study_name);
//                 sel_image_expanded = true;


//             } else {

//                 console.log('gets here close');

//                 $('#sel_image_frame').addClass('span3');
//                 $('#sel_image_frame').removeClass('span12');

//                 $('#zoom_frame').show();

//                 load_thumbnail_data(recent_study_name);
//                 sel_image_expanded = false;

//             }
//         });

//         $("#path_report_dialog").dialog({
//             autoOpen: false,
//             modal: false,
//             draggable: true,
//             width: 'auto'
//         });

//         load_thumbnail_data('LUAD'); //Need to change this to the value of the first item selected


//         $("#filter_dialog").html(color_filter_html); ///Loads the color filter selection for the disabled

//     });

//     $(function() {
//         // initialize the image viewer and annotation state

//         var annotationState = window.annotationState = new AnnotationState();
//         annotationState.setSeadragonViewer(viewer);
//         annotation_setup_code(annotationState);

//         function showMouse(event) {
//             // getMousePosition() returns position relative to page,
//             // while we want the position relative to the viewer
//             // element. so subtract the difference.
//             var pixel = OpenSeadragon.getMousePosition(event).minus(OpenSeadragon.getElementPosition(viewer.element));

//             document.getElementById("mousePixels").innerHTML = toString(pixel, true);

//             if (!viewer.isOpen()) {
//                 return;
//             }

//             var point = viewer.viewport.pointFromPixel(pixel);
//             document.getElementById("mousePoints").innerHTML = toString(point, true);
//         }

//         // showMouse doesn't exist, commented this out - jake
//         //        OpenSeadragon.addEvent(viewer.element, "mousemove", showMouse);
//         //        mousetracker = new OpenSeadragon.MouseTracker({
//         //            element: viewer.element,
//         //            clickTimeThreshold: 50,
//         //            clickDistThreshold: 50,
//         //            moveHandler: function(event) {
//         //            //    console.log(event.position);
//         //            }
//         //        });
//         console.log(mousetracker);


//         $('#data_group').change(function() {
//             if (!sel_image_expanded) {
//                 //load_thumbs($("#data_group option:selected").val());
//                 load_thumbnail_data($("#data_group option:selected").val());
//             } else {
//                 load_expanded_thumbnail_data($("#data_group option:selected").val());
//             }
//         });


//     });


