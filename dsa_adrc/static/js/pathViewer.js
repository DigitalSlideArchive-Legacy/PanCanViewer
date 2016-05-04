  $("#path_report_dialog").dialog({
            autoOpen: false,
            modal: false,
            draggable: true,
            width: 'auto'
        });



 function load_path_report(pid) {
        /* Given the patient ID, this will call the API and see if theres a pathology report */

        console.log('Should load path report for' + pid);
        $("#path_report_dialog").empty();
        $("#path_report_dialog").html(`<embed src="http://cancer.digitalslidearchive.emory.edu/api/v1/path_reports/${pid}" width="600" height="575" >`);

    }



 <div id="path_report_dialog" title="Pathology Report">
        Path Reports will appear here
    </div>


   $("#path_report_dialog").empty();
        $("#path_report_dialog").html(`<embed src="http://cancer.digitalslidearchive.emory.edu/api/v1/path_reports/${pid}" width="600" height="575" >`);

    }

import gridfs

@app.route('/api/v1/path_reports')
def get_pdf_reports():
    patientId = 'TCGA-OR-A5J1'
    matched_files = client['TCGA']['tcgaTarExtractFileList'].find_one( {'patientId': patientId})
    ### Eventually I should parse out the logic and see if there's more than one
    #gridfs_fileId = matched_files['fileId']

    pdf_fp = pdfGridFs.get( matched_files['fileId'])
#    def get_pdf(id=None):
#    if id is not None:
#    binary_pdf = get_binary_pdf_data_from_database(id=id)
    binary_pdf = pdf_fp
    response = make_response(binary_pdf.read())
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = \
        'inline; filename=%s.pdf' % 'samplegutman.pdf'
    return response



@app.route('/api/v1/path_reports/<string:patientId>')
def get_patient_pdf_report(patientId):
    matched_files = client['TCGA']['tcgaTarExtractFileList'].find_one( {'patientId': patientId})
    ### Eventually I should parse out the logic and see if there's more than one
    #gridfs_fileId = matched_files['fileId']

    pdf_filename = matched_files['filename']
    pdf_fp = pdfGridFs.get( matched_files['fileId'])
#    def get_pdf(id=None):
#    if id is not None:
#    binary_pdf = get_binary_pdf_data_from_database(id=id)
    binary_pdf = pdf_fp
    response = make_response(binary_pdf.read())
    response.headers['Content-Type'] = 'application/pdf'
    response.headers['Content-Disposition'] = \
        'inline; filename=%s.pdf' % pdf_filename
    return response

