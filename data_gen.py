import streamlit as st
import pandas as pd
import numpy as np
import random
import os
from io import StringIO

# Set page config
st.set_page_config(
    page_title="Synthetic Data Generator",
    page_icon="📊",
    layout="wide"
)

# Define 20 preset scenarios based on statistical test matrix
presets = {
    1: {"metric_type": "Continuous", "distribution": "Normal", "variance": "Equal", "paths": 2, "samples": 1000, "description": "t-test", "expected_test": "t-test"},
    2: {"metric_type": "Continuous", "distribution": "Normal", "variance": "Unequal", "paths": 2, "samples": 1000, "description": "Welch's t-test", "expected_test": "Welch's t-test"},
    3: {"metric_type": "Continuous", "distribution": "Skewed", "variance": "Equal", "paths": 2, "samples": 1000, "description": "Mann-Whitney", "expected_test": "Mann-Whitney"},
    4: {"metric_type": "Continuous", "distribution": "Skewed", "variance": "Unequal", "paths": 2, "samples": 1000, "description": "Mann-Whitney", "expected_test": "Mann-Whitney"},
    5: {"metric_type": "Continuous", "distribution": "Normal", "variance": "Equal", "paths": 4, "samples": 1000, "description": "ANOVA", "expected_test": "ANOVA"},
    6: {"metric_type": "Continuous", "distribution": "Normal", "variance": "Unequal", "paths": 4, "samples": 1000, "description": "Welch's ANOVA", "expected_test": "Welch's ANOVA"},
    7: {"metric_type": "Continuous", "distribution": "Skewed", "variance": "Equal", "paths": 4, "samples": 1000, "description": "Kruskal-Wallis", "expected_test": "Kruskal-Wallis"},
    8: {"metric_type": "Continuous", "distribution": "Skewed", "variance": "Unequal", "paths": 4, "samples": 1000, "description": "Kruskal-Wallis", "expected_test": "Kruskal-Wallis"},
    9: {"metric_type": "Proportion", "distribution": "Binary", "variance": "-", "paths": 2, "samples": 1000, "description": "Two-Proportion Z-Test", "expected_test": "Two-Proportion Z-Test"},
    10: {"metric_type": "Proportion", "distribution": "Binary", "variance": "-", "paths": 4, "samples": 1000, "description": "Chi-Square", "expected_test": "Chi-Square"},
    11: {"metric_type": "Categorical", "distribution": "Uniform", "variance": "-", "paths": 2, "samples": 1000, "description": "Chi-Square", "expected_test": "Chi-Square"},
    12: {"metric_type": "Categorical", "distribution": "Uniform", "variance": "-", "paths": 4, "samples": 1000, "description": "Chi-Square", "expected_test": "Chi-Square"},
    13: {"metric_type": "Continuous", "distribution": "Normal", "variance": "Equal", "paths": 2, "samples": 1000, "description": "t-test (duplicate)", "expected_test": "t-test (duplicate)"},
    14: {"metric_type": "Continuous", "distribution": "Skewed", "variance": "Unequal", "paths": 2, "samples": 1000, "description": "Mann-Whitney (duplicate)", "expected_test": "Mann-Whitney (duplicate)"},
    15: {"metric_type": "Proportion", "distribution": "Binary", "variance": "-", "paths": 2, "samples": 1000, "description": "Two-Proportion Z-Test (duplicate)", "expected_test": "Two-Proportion Z-Test (duplicate)"},
    16: {"metric_type": "Proportion", "distribution": "Binary", "variance": "-", "paths": 4, "samples": 1000, "description": "Chi-Square (duplicate)", "expected_test": "Chi-Square (duplicate)"},
    17: {"metric_type": "Continuous", "distribution": "Normal", "variance": "Equal", "paths": 4, "samples": 1000, "description": "ANOVA (confirm variance handling)", "expected_test": "ANOVA (confirm variance handling)"},
    18: {"metric_type": "Continuous", "distribution": "Skewed", "variance": "Unequal", "paths": 4, "samples": 1000, "description": "Kruskal-Wallis (reconfirm skew+variance)", "expected_test": "Kruskal-Wallis (reconfirm skew+variance)"},
    19: {"metric_type": "Proportion", "distribution": "Binary", "variance": "-", "paths": 4, "samples": 1000, "description": "Chi-Square (retest large groups)", "expected_test": "Chi-Square (retest large groups)"},
    20: {"metric_type": "Categorical", "distribution": "Uniform", "variance": "-", "paths": 4, "samples": 1000, "description": "Chi-Square (multi-level categorical)", "expected_test": "Chi-Square (multi-level categorical)"}
}

def load_scenario(scenario_num):
    """Load a preset scenario into session state"""
    if scenario_num in presets:
        preset = presets[scenario_num]
        st.session_state.current_scenario = scenario_num
        st.session_state.num_paths = preset["paths"]
        st.session_state.metric_type = preset["metric_type"]
        st.session_state.sample_size_per_path = preset["samples"]
        st.session_state.file_name = f"test inputs/scenario{scenario_num}.csv"
        
        # Only set distribution and variance for continuous data
        if preset["metric_type"] == "Continuous":
            st.session_state.distribution_shape = preset["distribution"]
            st.session_state.variance_condition = preset["variance"]

def generate_continuous_data(num_paths, sample_size_per_path, distribution_shape, variance_condition, group_prefix):
    """Generate continuous metric data"""
    data = []
    user_id_counter = 1
    
    for i in range(num_paths):
        group_name = f"{group_prefix} {chr(65 + i)}"  # Group A, Group B, etc.
        
        if distribution_shape == "Normal":
            if variance_condition == "Equal":
                # Same mean and std for all groups
                values = np.random.normal(loc=50, scale=10, size=sample_size_per_path)
            else:  # Unequal
                # Different means and std per group
                base_mean = 50 + (i * 10)  # 50, 60, 70, etc.
                base_std = 10 + (i * 5)   # 10, 15, 20, etc.
                values = np.random.normal(loc=base_mean, scale=base_std, size=sample_size_per_path)
        
        else:  # Skewed
            if variance_condition == "Equal":
                # Same shape and scale for all groups
                values = np.random.gamma(shape=2, scale=10, size=sample_size_per_path)
            else:  # Unequal
                # Different parameters per group
                shape = 2 + (i * 0.5)  # 2, 2.5, 3, etc.
                scale = 10 + (i * 5)   # 10, 15, 20, etc.
                values = np.random.gamma(shape=shape, scale=scale, size=sample_size_per_path)
        
        # Create records for this group
        for value in values:
            data.append({
                'user_id': user_id_counter,
                'group': group_name,
                'metric': value
            })
            user_id_counter += 1
    
    return pd.DataFrame(data)

def generate_proportion_data(num_paths, sample_size_per_path, group_prefix):
    """Generate proportion (0/1) metric data"""
    data = []
    user_id_counter = 1
    
    for i in range(num_paths):
        group_name = f"{group_prefix} {chr(65 + i)}"  # Group A, Group B, etc.
        
        # Different probability per group
        probability = 0.3 + (i * 0.2)  # 0.3, 0.5, 0.7, etc.
        probability = min(probability, 0.9)  # Cap at 0.9
        
        values = np.random.binomial(1, probability, size=sample_size_per_path)
        
        # Create records for this group
        for value in values:
            data.append({
                'user_id': user_id_counter,
                'group': group_name,
                'metric': value
            })
            user_id_counter += 1
    
    return pd.DataFrame(data)

def generate_categorical_data(num_paths, sample_size_per_path, group_prefix):
    """Generate categorical metric data"""
    data = []
    user_id_counter = 1
    categories = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange"]
    
    for i in range(num_paths):
        group_name = f"{group_prefix} {chr(65 + i)}"  # Group A, Group B, etc.
        
        # Different category weights per group
        if i == 0:
            weights = [0.4, 0.3, 0.2, 0.1, 0.0, 0.0]  # Favor Red/Blue
        elif i == 1:
            weights = [0.1, 0.2, 0.4, 0.3, 0.0, 0.0]  # Favor Green/Yellow
        elif i == 2:
            weights = [0.0, 0.1, 0.2, 0.3, 0.4, 0.0]  # Favor Purple
        else:
            weights = [0.1, 0.1, 0.1, 0.1, 0.3, 0.3]  # Favor Purple/Orange
        
        # Normalize weights to ensure they sum to 1
        weights = weights[:min(len(categories), 6)]
        weights = [w / sum(weights) for w in weights]
        
        values = np.random.choice(categories[:len(weights)], size=sample_size_per_path, p=weights)
        
        # Create records for this group
        for value in values:
            data.append({
                'user_id': user_id_counter,
                'group': group_name,
                'metric': value
            })
            user_id_counter += 1
    
    return pd.DataFrame(data)

def validate_inputs(num_paths, sample_size_per_path, group_prefix, file_name):
    """Validate user inputs"""
    errors = []
    
    if num_paths <= 0:
        errors.append("Number of Paths must be greater than 0")
    
    if sample_size_per_path <= 0:
        errors.append("Sample Size Per Path must be greater than 0")
    
    if not group_prefix.strip():
        errors.append("Group Label Prefix cannot be empty")
    
    if not file_name.strip():
        errors.append("File Name cannot be empty")
    elif not file_name.endswith('.csv'):
        errors.append("File Name must end with .csv")
    
    return errors

def main():
    st.title("📊 Synthetic Data Generator")
    st.markdown("Generate synthetic datasets for testing statistical scenarios")
    
    # Initialize session state for scenario tracking
    if 'current_scenario' not in st.session_state:
        st.session_state.current_scenario = None
    
    # Sidebar with preset scenarios
    with st.sidebar:
        st.header("🎯 Preset Scenarios")
        st.markdown("*Click any scenario to auto-populate form fields*")
        
        # Create 2 columns for better layout of buttons
        cols = st.columns(2)
        for i in range(1, 21):
            col_idx = (i - 1) % 2
            with cols[col_idx]:
                if st.button(f"Scenario {i}", key=f"scenario_{i}", use_container_width=True):
                    load_scenario(i)
                    st.rerun()
        
        # Display current scenario info
        if st.session_state.current_scenario is not None:
            scenario_num = st.session_state.current_scenario
            preset = presets[scenario_num]
            st.markdown("---")
            st.success(f"**Currently loaded:**\n\n**Scenario {scenario_num}**\n\n📊 **{preset['expected_test']}**")
            st.markdown(f"""
            **Parameters:**
            - Metric: {preset['metric_type']}
            - Groups: {preset['paths']}
            - Sample Size: {preset['samples']}
            """)
            if preset['metric_type'] == 'Continuous':
                st.markdown(f"- Distribution: {preset['distribution']}\n- Variance: {preset['variance']}")
            elif preset['metric_type'] in ['Proportion', 'Categorical']:
                st.markdown(f"- Distribution: {preset['distribution']}")

    # Create two columns for better layout
    col1, col2 = st.columns([1, 1])
    
    with col1:
        st.subheader("Data Configuration")
        
        # Number of Paths
        num_paths = st.selectbox(
            "Number of Paths (Groups)",
            [2, 4],
            index=[2, 4].index(st.session_state.get('num_paths', 2)),
            help="Number of different groups to generate",
            key='num_paths'
        )
        
        # Metric Type
        metric_type = st.selectbox(
            "Metric Type",
            ["Continuous", "Proportion", "Categorical"],
            index=["Continuous", "Proportion", "Categorical"].index(st.session_state.get('metric_type', 'Continuous')),
            help="Type of data to generate",
            key='metric_type'
        )
        
        # Conditional inputs based on metric type
        distribution_shape = None
        variance_condition = None
        
        if metric_type == "Continuous":
            distribution_shape = st.selectbox(
                "Distribution Shape",
                ["Normal", "Skewed"],
                index=["Normal", "Skewed"].index(st.session_state.get('distribution_shape', 'Normal')),
                help="Shape of the distribution for continuous data",
                key='distribution_shape'
            )
            
            variance_condition = st.selectbox(
                "Variance Condition",
                ["Equal", "Unequal"],
                index=["Equal", "Unequal"].index(st.session_state.get('variance_condition', 'Equal')),
                help="Whether groups have equal or different variances",
                key='variance_condition'
            )
    
    with col2:
        st.subheader("Output Configuration")
        
        # Sample Size
        sample_size_per_path = st.number_input(
            "Sample Size Per Path",
            min_value=1,
            max_value=10000,
            value=st.session_state.get('sample_size_per_path', 1000),
            step=100,
            help="Number of observations per group",
            key='sample_size_per_path'
        )
        
        # Group Label Prefix
        group_prefix = st.text_input(
            "Group Label Prefix",
            value="Group",
            help="Prefix for group names (e.g., 'Group' → 'Group A', 'Group B')"
        )
        
        # File Name
        file_name = st.text_input(
            "File Name",
            value=st.session_state.get('file_name', 'test inputs/synthetic_data.csv'),
            help="Name for the output CSV file (will be saved in test inputs folder)",
            key='file_name'
        )
    
    # Generate button
    st.markdown("---")
    
    if st.button("🎲 Generate Synthetic Data", type="primary"):
        # Validate inputs
        errors = validate_inputs(num_paths, sample_size_per_path, group_prefix, file_name)
        
        if errors:
            st.error("Please fix the following errors:")
            for error in errors:
                st.error(f"• {error}")
        else:
            with st.spinner("Generating synthetic data..."):
                # Generate data based on metric type
                if metric_type == "Continuous":
                    df = generate_continuous_data(
                        num_paths, sample_size_per_path, 
                        distribution_shape, variance_condition, group_prefix
                    )
                elif metric_type == "Proportion":
                    df = generate_proportion_data(
                        num_paths, sample_size_per_path, group_prefix
                    )
                else:  # Categorical
                    df = generate_categorical_data(
                        num_paths, sample_size_per_path, group_prefix
                    )
                
                # Display results
                st.success(f"✅ Generated synthetic dataset!")
                
                # Show dataset info
                col1, col2, col3 = st.columns(3)
                with col1:
                    st.metric("Total Rows", f"{len(df):,}")
                with col2:
                    st.metric("Groups", num_paths)
                with col3:
                    st.metric("Rows per Group", f"{sample_size_per_path:,}")
                
                # Display first few rows
                st.subheader("Dataset Preview")
                st.dataframe(df.head(10), use_container_width=True)
                
                # Show summary statistics
                st.subheader("Summary Statistics")
                if metric_type == "Continuous":
                    summary = df.groupby('group')['metric'].agg(['count', 'mean', 'std', 'min', 'max']).round(2)
                    st.dataframe(summary, use_container_width=True)
                elif metric_type == "Proportion":
                    summary = df.groupby('group')['metric'].agg(['count', 'mean', 'sum']).round(3)
                    summary.columns = ['Count', 'Proportion', 'Total_Successes']
                    st.dataframe(summary, use_container_width=True)
                else:  # Categorical
                    summary = df.groupby(['group', 'metric']).size().unstack(fill_value=0)
                    st.dataframe(summary, use_container_width=True)
                
                # Ensure test inputs directory exists
                os.makedirs("test inputs", exist_ok=True)
                
                # Download button
                csv = df.to_csv(index=False)
                st.download_button(
                    label="📥 Download CSV",
                    data=csv,
                    file_name=file_name,
                    mime="text/csv",
                    type="primary",
                    use_container_width=True
                )
                
                st.info(f"💾 Dataset ready for download as '{file_name}'")

if __name__ == "__main__":
    main()
