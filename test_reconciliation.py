from src.services.reconciliation import reconcile_columns, normalize_column_name

def test_normalization():
    print("--- Testing Normalization ---")
    tests = ["WTSRDocNumber", "WorkTaskID", "task_number", "AssetID", "Temperature Celsius"]
    for t in tests:
        print(f"Original: {t:<20} -> Normalized: {normalize_column_name(t)}")

def test_reconciliation():
    print("\n--- Testing Reconciliation ---")
    
    # Expected analytical columns
    expected_logical = ["work_task_number", "asset_id", "temperature", "issue_date"]
    
    # Simulating File 1 headers
    file_1_source = ["WTSRDocNumber", "AssetID", "temp c", "date_issued"]
    
    # Simulating File 2 headers
    file_2_source = ["TaskNumber", "Machine ID", "Mixing Temperature", "CreationDate", "unknown_field"]
    
    print("File 1 Mappings:")
    res1 = reconcile_columns(file_1_source, expected_logical)
    for k, v in res1.items():
        print(f"  {k:<20} -> {v}")
        
    print("\nFile 2 Mappings:")
    res2 = reconcile_columns(file_2_source, expected_logical)
    for k, v in res2.items():
        print(f"  {k:<20} -> {v}")

if __name__ == "__main__":
    test_normalization()
    test_reconciliation()
