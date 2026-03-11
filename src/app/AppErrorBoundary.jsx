import React from "react";

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state">
          <div className="empty-state__hero">
            <p className="eyebrow">Blackbox Flight Analyzer</p>
            <h1>Review surface crashed.</h1>
            <p>
              {this.state.error.message ||
                "An unexpected rendering error occurred while preparing the flight view."}
            </p>
            <button className="transport" type="button" onClick={() => window.location.reload()}>
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
