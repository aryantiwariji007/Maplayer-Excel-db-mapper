const fs = require('fs');
const path = require('path');

async function test() {
    // 1. Detect
    const formData = new FormData();
    const blob = new Blob([fs.readFileSync(path.join(__dirname, 'testing', 'CRM Spreadsheet.xlsx'))]);
    formData.append('file', blob, 'CRM Spreadsheet.xlsx');
    formData.append('product_id', 'ScotAI-customer');

    const detectRes = await fetch('http://localhost:3000/map/detect-schema', {
        method: 'POST',
        body: formData
    });

    const detectJson = await detectRes.json();
    console.log("Detect result:", detectJson);

    // 2. Transform
    const transformRes = await fetch('http://localhost:3000/map/transform', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            job_id: detectJson.job_id,
            confirmed_mappings: [
                {
                    source_column: 'Name',
                    target_key: 'full_name',
                    confidence: 1.0,
                    requires_review: false
                }
            ]
        })
    });

    const transformJson = await transformRes.json();
    console.log("Transformed rows count:", transformJson.rows?.length);
    console.log("Transformed sample row:", transformJson.rows?.[0]);
}

test().catch(console.error);
