from sqlalchemy import create_engine, text
try:
    engine = create_engine('postgresql://maplayer:maplayer_password@localhost:5432/maplayer_db')
    with engine.connect() as conn:
        res = conn.execute(text('SELECT d.file_name AS source_file, t.* FROM "analytics_cf4677ce_7914_473a_913c_ae439afba631" t LEFT JOIN datasets d ON t.dataset_id = d.id LIMIT 500'))
        print("COLUMNS: ", [k for k in res.keys()])
except Exception as e:
    print('Error:', e)
